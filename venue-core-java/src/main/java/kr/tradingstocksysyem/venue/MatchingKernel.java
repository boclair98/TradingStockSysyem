package kr.tradingstocksysyem.venue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;

import static kr.tradingstocksysyem.venue.VenueTypes.*;

public final class MatchingKernel {
    private static final class Order {
        final long id;
        final String clientOrderId;
        final String memberId;
        final String symbol;
        final Side side;
        final OrderType orderType;
        final TimeInForce timeInForce;
        final long price;
        final long quantity;
        final long acceptedSequence;
        long remaining;
        OrderStatus status = OrderStatus.OPEN;

        Order(long id, NewOrder command, long acceptedSequence) {
            this.id = id; this.clientOrderId = command.clientOrderId(); this.memberId = command.memberId();
            this.symbol = command.symbol(); this.side = command.side(); this.orderType = command.orderType();
            this.timeInForce = command.timeInForce(); this.price = command.price(); this.quantity = command.quantity();
            this.remaining = command.quantity(); this.acceptedSequence = acceptedSequence;
        }
    }

    private static final class Book {
        final NavigableMap<Long, ArrayDeque<Long>> bids = new TreeMap<>(Comparator.reverseOrder());
        final NavigableMap<Long, ArrayDeque<Long>> asks = new TreeMap<>();
    }

    private final Map<String, Instrument> instruments = new HashMap<>();
    private final Map<String, Book> books = new HashMap<>();
    private final Map<Long, Order> orders = new HashMap<>();
    private final Set<String> memberClientIds = new HashSet<>();
    private final Map<String, Integer> openOrderCountByMember = new HashMap<>();
    private final RiskGate riskGate;
    private final SelfTradePolicy selfTradePolicy;
    private long commandSequence;
    private long eventSequence;
    private long nextOrderId = 1;
    private long nextExecutionId = 1;

    public MatchingKernel(Collection<Instrument> admitted, RiskGate riskGate) {
        this(admitted, riskGate, SelfTradePolicy.CANCEL_AGGRESSOR);
    }

    public MatchingKernel(Collection<Instrument> admitted, RiskGate riskGate, SelfTradePolicy selfTradePolicy) {
        this.riskGate = Objects.requireNonNull(riskGate);
        this.selfTradePolicy = Objects.requireNonNull(selfTradePolicy);
        for (Instrument instrument : admitted) instruments.put(instrument.symbol(), instrument);
    }

    public CommandResult process(Command command) {
        long sequence = ++commandSequence;
        List<VenueEvent> events = switch (command) {
            case NewOrder next -> submit(next);
            case CancelOrder cancel -> cancel(cancel.memberId(), cancel.venueOrderId(), "MEMBER_REQUEST");
            case ReplaceOrder replace -> replace(replace);
        };
        return new CommandResult(sequence, List.copyOf(events));
    }

    private List<VenueEvent> submit(NewOrder command) {
        List<VenueEvent> events = new ArrayList<>();
        String validation = validate(command);
        if (validation != null) return reject(command.clientOrderId(), command.memberId(), validation, events);
        String clientKey = command.memberId() + '\u0000' + command.clientOrderId();
        if (!memberClientIds.add(clientKey)) return reject(command.clientOrderId(), command.memberId(), "DUPLICATE_CLIENT_ORDER_ID", events);
        Instrument instrument = instruments.get(command.symbol());
        String risk = riskGate.rejectReason(command, instrument, countOpenOrders(command.memberId()));
        if (risk != null) return reject(command.clientOrderId(), command.memberId(), risk, events);

        Book book = books.computeIfAbsent(command.symbol(), ignored -> new Book());
        if (command.timeInForce() == TimeInForce.FOK && !canFullyExecute(command, book)) return reject(command.clientOrderId(), command.memberId(), "FOK_NOT_FILLABLE", events);

        long orderId = nextOrderId++;
        Order taker = new Order(orderId, command, eventSequence + 1);
        orders.put(orderId, taker);
        events.add(new Accepted(nextEvent(), orderId, command.clientOrderId(), command.memberId(), command.symbol()));
        match(taker, book, events);

        if (taker.remaining == 0) taker.status = OrderStatus.FILLED;
        else if (taker.orderType == OrderType.LIMIT && taker.timeInForce == TimeInForce.DAY && taker.status != OrderStatus.CANCELLED) {
            taker.status = taker.remaining == taker.quantity ? OrderStatus.OPEN : OrderStatus.PARTIAL;
            addToBook(book, taker);
            incrementOpen(taker.memberId);
        } else if (taker.status != OrderStatus.CANCELLED) {
            taker.status = OrderStatus.CANCELLED;
            events.add(new Cancelled(nextEvent(), taker.id, taker.memberId, "UNFILLED_REMAINDER"));
        }
        return events;
    }

    private void match(Order taker, Book book, List<VenueEvent> events) {
        NavigableMap<Long, ArrayDeque<Long>> opposite = taker.side == Side.BUY ? book.asks : book.bids;
        while (taker.remaining > 0 && !opposite.isEmpty()) {
            Map.Entry<Long, ArrayDeque<Long>> level = opposite.firstEntry();
            if (!crosses(taker.side, taker.orderType, taker.price, level.getKey())) break;
            ArrayDeque<Long> queue = level.getValue();
            Order maker = orders.get(queue.peekFirst());
            if (maker == null || maker.remaining == 0 || maker.status == OrderStatus.CANCELLED) { queue.removeFirst(); cleanupLevel(opposite, level.getKey(), queue); continue; }
            if (maker.memberId.equals(taker.memberId) && selfTradePolicy == SelfTradePolicy.CANCEL_AGGRESSOR) {
                taker.status = OrderStatus.CANCELLED;
                events.add(new Cancelled(nextEvent(), taker.id, taker.memberId, "SELF_TRADE_PREVENTION"));
                return;
            }
            long quantity = Math.min(taker.remaining, maker.remaining);
            taker.remaining -= quantity; maker.remaining -= quantity;
            events.add(new Executed(nextEvent(), nextExecutionId++, maker.id, taker.id, taker.symbol, maker.price, quantity));
            maker.status = maker.remaining == 0 ? OrderStatus.FILLED : OrderStatus.PARTIAL;
            if (maker.remaining == 0) { queue.removeFirst(); cleanupLevel(opposite, level.getKey(), queue); decrementOpen(maker.memberId); }
            taker.status = taker.remaining == 0 ? OrderStatus.FILLED : OrderStatus.PARTIAL;
        }
    }

    private List<VenueEvent> cancel(String memberId, long orderId, String reason) {
        List<VenueEvent> events = new ArrayList<>();
        Order order = orders.get(orderId);
        if (order == null) return reject("", memberId, "ORDER_NOT_FOUND", events);
        if (!order.memberId.equals(memberId)) return reject(order.clientOrderId, memberId, "ORDER_OWNERSHIP_MISMATCH", events);
        if (order.status != OrderStatus.OPEN && order.status != OrderStatus.PARTIAL) return reject(order.clientOrderId, memberId, "ORDER_NOT_CANCELLABLE", events);
        removeFromBook(books.get(order.symbol), order);
        order.status = OrderStatus.CANCELLED;
        decrementOpen(order.memberId);
        events.add(new Cancelled(nextEvent(), order.id, memberId, reason));
        return events;
    }

    private List<VenueEvent> replace(ReplaceOrder replace) {
        Order old = orders.get(replace.venueOrderId());
        if (old == null) return reject(replace.clientOrderId(), replace.memberId(), "ORDER_NOT_FOUND", new ArrayList<>());
        if (!old.memberId.equals(replace.memberId())) return reject(replace.clientOrderId(), replace.memberId(), "ORDER_OWNERSHIP_MISMATCH", new ArrayList<>());
        long filled = old.quantity - old.remaining;
        if (replace.newQuantity() < filled) return reject(replace.clientOrderId(), replace.memberId(), "REPLACE_BELOW_FILLED_QUANTITY", new ArrayList<>());
        List<VenueEvent> events = cancel(replace.memberId(), replace.venueOrderId(), "REPLACED");
        NewOrder command = new NewOrder(replace.clientOrderId(), replace.memberId(), old.symbol, old.side, old.orderType, old.timeInForce, replace.newPrice(), replace.newQuantity() - filled, replace.receivedNanos());
        List<VenueEvent> replacementEvents = submit(command);
        events.addAll(replacementEvents);
        replacementEvents.stream().filter(Accepted.class::isInstance).map(Accepted.class::cast).findFirst().ifPresent(ack -> events.add(new Replaced(nextEvent(), old.id, ack.venueOrderId(), replace.memberId())));
        return events;
    }

    private boolean canFullyExecute(NewOrder command, Book book) {
        NavigableMap<Long, ArrayDeque<Long>> opposite = command.side() == Side.BUY ? book.asks : book.bids;
        long available = 0;
        for (Map.Entry<Long, ArrayDeque<Long>> level : opposite.entrySet()) {
            if (!crosses(command.side(), command.orderType(), command.price(), level.getKey())) break;
            for (long id : level.getValue()) {
                Order maker = orders.get(id);
                if (maker == null || maker.remaining == 0) continue;
                if (maker.memberId.equals(command.memberId())) return false;
                available += maker.remaining;
                if (available >= command.quantity()) return true;
            }
        }
        return false;
    }

    private String validate(NewOrder command) {
        if (command.clientOrderId() == null || !command.clientOrderId().matches("[A-Za-z0-9._-]{1,64}")) return "INVALID_CLIENT_ORDER_ID";
        if (command.memberId() == null || !command.memberId().matches("[A-Z0-9]{4,12}")) return "INVALID_MEMBER_ID";
        Instrument instrument = instruments.get(command.symbol());
        if (instrument == null) return "INSTRUMENT_NOT_ADMITTED";
        if (command.quantity() <= 0 || command.quantity() % instrument.lotSize() != 0) return "INVALID_QUANTITY";
        if (command.price() <= 0 || command.price() % instrument.tickSize() != 0) return "INVALID_PRICE_TICK";
        if (command.price() < instrument.lowerBand() || command.price() > instrument.upperBand()) return "PRICE_OUTSIDE_DAILY_BAND";
        if (command.orderType() == OrderType.MARKET && command.timeInForce() == TimeInForce.DAY) return "MARKET_ORDER_CANNOT_REST";
        return null;
    }

    private List<VenueEvent> reject(String clientOrderId, String memberId, String code, List<VenueEvent> events) {
        events.add(new Rejected(nextEvent(), clientOrderId == null ? "" : clientOrderId, memberId == null ? "" : memberId, code, code));
        return events;
    }

    private int countOpenOrders(String memberId) { return openOrderCountByMember.getOrDefault(memberId, 0); }
    private void incrementOpen(String memberId) { openOrderCountByMember.merge(memberId, 1, Integer::sum); }
    private void decrementOpen(String memberId) { openOrderCountByMember.compute(memberId, (ignored, count) -> count == null || count <= 1 ? null : count - 1); }

    private static boolean crosses(Side side, OrderType type, long protectionPrice, long makerPrice) {
        if (type == OrderType.MARKET) return side == Side.BUY ? makerPrice <= protectionPrice : makerPrice >= protectionPrice;
        return side == Side.BUY ? makerPrice <= protectionPrice : makerPrice >= protectionPrice;
    }

    private void addToBook(Book book, Order order) {
        NavigableMap<Long, ArrayDeque<Long>> side = order.side == Side.BUY ? book.bids : book.asks;
        side.computeIfAbsent(order.price, ignored -> new ArrayDeque<>()).addLast(order.id);
    }

    private void removeFromBook(Book book, Order order) {
        if (book == null) return;
        NavigableMap<Long, ArrayDeque<Long>> side = order.side == Side.BUY ? book.bids : book.asks;
        ArrayDeque<Long> queue = side.get(order.price);
        if (queue != null) { queue.remove(order.id); cleanupLevel(side, order.price, queue); }
    }

    private static void cleanupLevel(NavigableMap<Long, ArrayDeque<Long>> side, long price, ArrayDeque<Long> queue) { if (queue.isEmpty()) side.remove(price); }
    private long nextEvent() { return ++eventSequence; }

    public long commandSequence() { return commandSequence; }
    public long eventSequence() { return eventSequence; }

    public String stateDigest() {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            List<Order> stable = new ArrayList<>(orders.values());
            stable.sort(Comparator.comparingLong(order -> order.id));
            for (Order order : stable) {
                String row = order.id + "|" + order.clientOrderId + "|" + order.memberId + "|" + order.symbol + "|" + order.side + "|" + order.price + "|" + order.quantity + "|" + order.remaining + "|" + order.status + "\n";
                digest.update(row.getBytes(StandardCharsets.UTF_8));
            }
            List<String> clients = new ArrayList<>(memberClientIds); Collections.sort(clients);
            for (String client : clients) digest.update(("K=" + client + "\n").getBytes(StandardCharsets.UTF_8));
            List<String> members = new ArrayList<>(openOrderCountByMember.keySet()); Collections.sort(members);
            for (String member : members) digest.update(("R=" + member + "|" + openOrderCountByMember.get(member) + "\n").getBytes(StandardCharsets.UTF_8));
            digest.update(("C=" + commandSequence + "|E=" + eventSequence + "|O=" + nextOrderId + "|X=" + nextExecutionId).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
