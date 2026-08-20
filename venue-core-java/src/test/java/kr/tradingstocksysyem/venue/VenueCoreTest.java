package kr.tradingstocksysyem.venue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static kr.tradingstocksysyem.venue.VenueTypes.*;

public final class VenueCoreTest {
    private static final Instrument SAMSUNG = new Instrument("005930", 70_000, 100, 1, 1_000_000, 30);
    private static long clock = 1_000;

    public static void main(String[] args) throws Exception {
        priceTimeAndMakerPrice();
        iocFokAndSelfTradePrevention();
        riskAndReplacePriority();
        validationIdempotencyAndOwnership();
        commandCodecRoundTrip();
        durableReplayIsDeterministic();
        randomizedJournalReplayIsDeterministic();
        corruptedJournalIsRejected();
        System.out.println("VenueCoreTest: 8/8 passed");
    }

    private static void priceTimeAndMakerPrice() {
        MatchingKernel kernel = kernel();
        long first = acceptedOrderId(kernel.process(limit("S-1", "MEM1", Side.SELL, TimeInForce.DAY, 70_000, 10)));
        long second = acceptedOrderId(kernel.process(limit("S-2", "MEM2", Side.SELL, TimeInForce.DAY, 70_000, 10)));
        CommandResult result = kernel.process(new NewOrder("B-1", "MEM3", "005930", Side.BUY, OrderType.MARKET, TimeInForce.IOC, 71_000, 15, clock++));
        List<Executed> fills = result.events().stream().filter(Executed.class::isInstance).map(Executed.class::cast).toList();
        check(fills.size() == 2, "expected two fills");
        check(fills.get(0).makerOrderId() == first && fills.get(0).price() == 70_000 && fills.get(0).quantity() == 10, "first maker priority failed");
        check(fills.get(1).makerOrderId() == second && fills.get(1).quantity() == 5, "second maker priority failed");
    }

    private static void iocFokAndSelfTradePrevention() {
        MatchingKernel kernel = kernel();
        kernel.process(limit("A-1", "MEM1", Side.SELL, TimeInForce.DAY, 70_000, 5));
        CommandResult fok = kernel.process(limit("B-FOK", "MEM2", Side.BUY, TimeInForce.FOK, 70_000, 6));
        check(hasReject(fok, "FOK_NOT_FILLABLE"), "unfillable FOK was not rejected");
        CommandResult ioc = kernel.process(limit("B-IOC", "MEM2", Side.BUY, TimeInForce.IOC, 70_000, 6));
        check(ioc.events().stream().anyMatch(event -> event instanceof Executed fill && fill.quantity() == 5), "IOC did not fill available quantity");
        check(ioc.events().stream().anyMatch(event -> event instanceof Cancelled cancelled && cancelled.reason().equals("UNFILLED_REMAINDER")), "IOC remainder was not cancelled");

        MatchingKernel stpKernel = kernel();
        stpKernel.process(limit("SELF-S", "MEM1", Side.SELL, TimeInForce.DAY, 70_000, 2));
        CommandResult stp = stpKernel.process(limit("SELF-B", "MEM1", Side.BUY, TimeInForce.IOC, 70_000, 2));
        check(stp.events().stream().anyMatch(event -> event instanceof Cancelled cancelled && cancelled.reason().equals("SELF_TRADE_PREVENTION")), "STP did not cancel aggressor");
        check(stp.events().stream().noneMatch(Executed.class::isInstance), "self trade executed");
    }

    private static void riskAndReplacePriority() {
        RiskGate risk = new RiskGate(); risk.setLimits("MEM1", new MemberLimits(2, 1_000_000, 10));
        MatchingKernel riskKernel = new MatchingKernel(List.of(SAMSUNG), risk);
        check(hasReject(riskKernel.process(limit("BIG", "MEM1", Side.BUY, TimeInForce.DAY, 70_000, 3)), "MEMBER_QUANTITY_LIMIT"), "quantity risk not enforced");
        risk.setHalted("MEM1", true);
        check(hasReject(riskKernel.process(limit("HALT", "MEM1", Side.BUY, TimeInForce.DAY, 70_000, 1)), "MEMBER_HALTED"), "member halt not enforced");

        MatchingKernel kernel = kernel();
        long oldId = acceptedOrderId(kernel.process(limit("B-OLD", "MEM1", Side.BUY, TimeInForce.DAY, 70_000, 2)));
        long secondId = acceptedOrderId(kernel.process(limit("B-SECOND", "MEM2", Side.BUY, TimeInForce.DAY, 70_000, 2)));
        kernel.process(new ReplaceOrder("B-REPLACED", "MEM1", oldId, 70_000, 2, clock++));
        CommandResult sell = kernel.process(limit("S-MATCH", "MEM3", Side.SELL, TimeInForce.IOC, 70_000, 1));
        Executed fill = sell.events().stream().filter(Executed.class::isInstance).map(Executed.class::cast).findFirst().orElseThrow();
        check(fill.makerOrderId() == secondId, "replace did not lose time priority");
    }

    private static void durableReplayIsDeterministic() throws Exception {
        Path dir = Files.createTempDirectory("venue-core-replay-"); Path journal = dir.resolve("commands.wal");
        String firstDigest;
        try (DurableVenueProcessor processor = new DurableVenueProcessor(journal, kernel())) {
            processor.process(limit("S-1", "MEM1", Side.SELL, TimeInForce.DAY, 70_000, 4));
            processor.process(limit("B-1", "MEM2", Side.BUY, TimeInForce.IOC, 70_000, 3));
            firstDigest = processor.stateDigest();
            check(processor.commandSequence() == 2, "durable command sequence mismatch");
        }
        try (DurableVenueProcessor recovered = new DurableVenueProcessor(journal, kernel())) {
            check(firstDigest.equals(recovered.stateDigest()), "replayed state digest diverged");
        }
    }

    private static void validationIdempotencyAndOwnership() {
        MatchingKernel kernel = kernel();
        CommandResult original = kernel.process(limit("UNIQUE", "MEM1", Side.BUY, TimeInForce.DAY, 70_000, 1));
        long orderId = acceptedOrderId(original);
        check(hasReject(kernel.process(limit("UNIQUE", "MEM1", Side.BUY, TimeInForce.DAY, 70_000, 1)), "DUPLICATE_CLIENT_ORDER_ID"), "duplicate client id accepted");
        check(hasReject(kernel.process(new CancelOrder("MEM2", orderId, clock++)), "ORDER_OWNERSHIP_MISMATCH"), "foreign cancel accepted");
        check(hasReject(kernel.process(limit("BAD-TICK", "MEM2", Side.BUY, TimeInForce.DAY, 70_050, 1)), "INVALID_PRICE_TICK"), "off-tick order accepted");
        check(hasReject(kernel.process(limit("BAD-BAND", "MEM2", Side.BUY, TimeInForce.DAY, 100_000, 1)), "PRICE_OUTSIDE_DAILY_BAND"), "out-of-band order accepted");
    }

    private static void commandCodecRoundTrip() throws Exception {
        List<Command> commands = List.of(
            limit("CODEC-NEW", "MEM1", Side.SELL, TimeInForce.FOK, 70_000, 4),
            new CancelOrder("MEM1", 9, clock++),
            new ReplaceOrder("CODEC-REPLACE", "MEM1", 9, 70_100, 3, clock++)
        );
        for (Command command : commands) check(command.equals(CommandCodec.decode(CommandCodec.encode(command))), "command codec round-trip failed");
    }

    private static void randomizedJournalReplayIsDeterministic() throws Exception {
        Path dir = Files.createTempDirectory("venue-core-random-"); Path journal = dir.resolve("commands.wal");
        java.util.Random random = new java.util.Random(20260809L);
        String firstDigest;
        try (DurableVenueProcessor processor = new DurableVenueProcessor(journal, kernel())) {
            for (int index = 0; index < 2_000; index++) {
                String member = "M" + String.format("%03d", random.nextInt(40) + 1);
                Side side = random.nextBoolean() ? Side.BUY : Side.SELL;
                long price = 68_000 + random.nextInt(41) * 100L;
                TimeInForce tif = random.nextInt(5) == 0 ? TimeInForce.IOC : TimeInForce.DAY;
                processor.process(new NewOrder("R-" + index, member, "005930", side, OrderType.LIMIT, tif, price, random.nextInt(5) + 1, index + 1L));
            }
            firstDigest = processor.stateDigest();
        }
        try (DurableVenueProcessor recovered = new DurableVenueProcessor(journal, kernel())) {
            check(firstDigest.equals(recovered.stateDigest()), "randomized replay digest diverged");
            check(recovered.commandSequence() == 2_000, "randomized replay sequence mismatch");
        }
    }

    private static void corruptedJournalIsRejected() throws Exception {
        Path dir = Files.createTempDirectory("venue-core-corrupt-"); Path journal = dir.resolve("commands.wal");
        try (DurableVenueProcessor processor = new DurableVenueProcessor(journal, kernel())) { processor.process(limit("S-1", "MEM1", Side.SELL, TimeInForce.DAY, 70_000, 1)); }
        byte[] bytes = Files.readAllBytes(journal); bytes[bytes.length - 5] ^= 0x5A; Files.write(journal, bytes);
        try { DurableJournal.readAll(journal); throw new AssertionError("corrupt journal was accepted"); }
        catch (IOException expected) { check(expected.getMessage().contains("CRC"), "wrong corruption error"); }
    }

    private static MatchingKernel kernel() { return new MatchingKernel(List.of(SAMSUNG), new RiskGate()); }
    private static NewOrder limit(String id, String member, Side side, TimeInForce tif, long price, long quantity) { return new NewOrder(id, member, "005930", side, OrderType.LIMIT, tif, price, quantity, clock++); }
    private static long acceptedOrderId(CommandResult result) { return result.events().stream().filter(Accepted.class::isInstance).map(Accepted.class::cast).findFirst().orElseThrow().venueOrderId(); }
    private static boolean hasReject(CommandResult result, String code) { return result.events().stream().anyMatch(event -> event instanceof Rejected rejected && rejected.code().equals(code)); }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
