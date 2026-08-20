package kr.tradingstocksysyem.venue;

import java.util.List;
import static kr.tradingstocksysyem.venue.VenueTypes.*;

public final class VenueCoreBenchmark {
    public static void main(String[] args) {
        int count = args.length == 0 ? 250_000 : Integer.parseInt(args[0]);
        Instrument instrument = new Instrument("005930", 70_000, 100, 1, 10_000_000, 30);
        MatchingKernel kernel = new MatchingKernel(List.of(instrument), new RiskGate());
        String[] members = new String[100];
        for (int index = 0; index < members.length; index++) members[index] = "M" + String.format("%03d", index + 1);
        long started = System.nanoTime();
        for (int index = 0; index < count; index++) {
            Side side = (index & 1) == 0 ? Side.BUY : Side.SELL;
            String member = members[index % members.length];
            long price = side == Side.BUY ? 69_900 : 70_100;
            kernel.process(new NewOrder("B-" + index, member, "005930", side, OrderType.LIMIT, TimeInForce.DAY, price, 1, index + 1L));
        }
        double seconds = (System.nanoTime() - started) / 1_000_000_000.0;
        System.out.printf("commands=%d seconds=%.3f throughput=%.0f cmd/s digest=%s%n", count, seconds, count / seconds, kernel.stateDigest());
    }
}
