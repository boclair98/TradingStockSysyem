package kr.tradingstocksysyem.venue;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static kr.tradingstocksysyem.venue.VenueTypes.*;

public final class RiskGate {
    private static final MemberLimits DEFAULT_LIMITS = new MemberLimits(100_000, 10_000_000_000L, 10_000);
    private final Map<String, MemberLimits> limits = new HashMap<>();
    private final Set<String> haltedMembers = new HashSet<>();

    public void setLimits(String memberId, MemberLimits memberLimits) { limits.put(required(memberId), memberLimits); }
    public void setHalted(String memberId, boolean halted) {
        String id = required(memberId);
        if (halted) haltedMembers.add(id); else haltedMembers.remove(id);
    }

    public String rejectReason(NewOrder command, Instrument instrument, int openOrders) {
        if (haltedMembers.contains(command.memberId())) return "MEMBER_HALTED";
        MemberLimits memberLimits = limits.getOrDefault(command.memberId(), DEFAULT_LIMITS);
        if (command.quantity() > memberLimits.maxOrderQuantity()) return "MEMBER_QUANTITY_LIMIT";
        if (command.quantity() > instrument.maxOrderQuantity()) return "INSTRUMENT_QUANTITY_LIMIT";
        if (openOrders >= memberLimits.maxOpenOrders()) return "MEMBER_OPEN_ORDER_LIMIT";
        try {
            if (Math.multiplyExact(command.price(), command.quantity()) > memberLimits.maxOrderNotional()) return "MEMBER_NOTIONAL_LIMIT";
        } catch (ArithmeticException overflow) { return "NOTIONAL_OVERFLOW"; }
        return null;
    }

    private static String required(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("memberId is required");
        return value;
    }
}
