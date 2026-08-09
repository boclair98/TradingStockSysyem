package kr.tradingstocksysyem.venue;

import java.util.List;

public final class VenueTypes {
    private VenueTypes() {}

    public enum Side { BUY, SELL }
    public enum OrderType { LIMIT, MARKET }
    public enum TimeInForce { DAY, IOC, FOK }
    public enum OrderStatus { OPEN, PARTIAL, FILLED, CANCELLED, REJECTED }
    public enum SelfTradePolicy { CANCEL_AGGRESSOR }

    public sealed interface Command permits NewOrder, CancelOrder, ReplaceOrder {}

    public record NewOrder(
        String clientOrderId,
        String memberId,
        String symbol,
        Side side,
        OrderType orderType,
        TimeInForce timeInForce,
        long price,
        long quantity,
        long receivedNanos
    ) implements Command {}

    public record CancelOrder(String memberId, long venueOrderId, long receivedNanos) implements Command {}

    public record ReplaceOrder(
        String clientOrderId,
        String memberId,
        long venueOrderId,
        long newPrice,
        long newQuantity,
        long receivedNanos
    ) implements Command {}

    public sealed interface VenueEvent permits Accepted, Rejected, Executed, Cancelled, Replaced {}

    public record Accepted(long eventSequence, long venueOrderId, String clientOrderId, String memberId, String symbol) implements VenueEvent {}
    public record Rejected(long eventSequence, String clientOrderId, String memberId, String code, String reason) implements VenueEvent {}
    public record Executed(long eventSequence, long executionId, long makerOrderId, long takerOrderId, String symbol, long price, long quantity) implements VenueEvent {}
    public record Cancelled(long eventSequence, long venueOrderId, String memberId, String reason) implements VenueEvent {}
    public record Replaced(long eventSequence, long oldOrderId, long newOrderId, String memberId) implements VenueEvent {}

    public record CommandResult(long commandSequence, List<VenueEvent> events) {}

    public record Instrument(String symbol, long referencePrice, long tickSize, long lotSize, long maxOrderQuantity, int dailyBandPercent) {
        public Instrument {
            if (symbol == null || !symbol.matches("\\d{6}")) throw new IllegalArgumentException("symbol must be six digits");
            if (referencePrice <= 0 || tickSize <= 0 || lotSize <= 0 || maxOrderQuantity < lotSize) throw new IllegalArgumentException("invalid instrument limits");
            if (dailyBandPercent <= 0 || dailyBandPercent > 50) throw new IllegalArgumentException("invalid daily band");
        }
        public long lowerBand() { return Math.max(tickSize, roundDown(referencePrice * (100L - dailyBandPercent) / 100L, tickSize)); }
        public long upperBand() { return roundDown(referencePrice * (100L + dailyBandPercent) / 100L, tickSize); }
        private static long roundDown(long value, long unit) { return value - value % unit; }
    }

    public record MemberLimits(long maxOrderQuantity, long maxOrderNotional, int maxOpenOrders) {
        public MemberLimits {
            if (maxOrderQuantity <= 0 || maxOrderNotional <= 0 || maxOpenOrders <= 0) throw new IllegalArgumentException("invalid member limits");
        }
    }
}
