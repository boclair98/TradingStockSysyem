package kr.tradingstocksysyem.venue;

import java.io.*;

import static kr.tradingstocksysyem.venue.VenueTypes.*;

public final class CommandCodec {
    private static final int NEW = 1;
    private static final int CANCEL = 2;
    private static final int REPLACE = 3;
    private CommandCodec() {}

    public static byte[] encode(Command command) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(160);
            try (DataOutputStream out = new DataOutputStream(bytes)) {
                switch (command) {
                    case NewOrder next -> {
                        out.writeByte(NEW); out.writeUTF(next.clientOrderId()); out.writeUTF(next.memberId()); out.writeUTF(next.symbol());
                        out.writeByte(next.side().ordinal()); out.writeByte(next.orderType().ordinal()); out.writeByte(next.timeInForce().ordinal());
                        out.writeLong(next.price()); out.writeLong(next.quantity()); out.writeLong(next.receivedNanos());
                    }
                    case CancelOrder cancel -> {
                        out.writeByte(CANCEL); out.writeUTF(cancel.memberId()); out.writeLong(cancel.venueOrderId()); out.writeLong(cancel.receivedNanos());
                    }
                    case ReplaceOrder replace -> {
                        out.writeByte(REPLACE); out.writeUTF(replace.clientOrderId()); out.writeUTF(replace.memberId()); out.writeLong(replace.venueOrderId());
                        out.writeLong(replace.newPrice()); out.writeLong(replace.newQuantity()); out.writeLong(replace.receivedNanos());
                    }
                }
            }
            return bytes.toByteArray();
        } catch (IOException impossible) { throw new UncheckedIOException(impossible); }
    }

    public static Command decode(byte[] payload) throws IOException {
        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(payload))) {
            Command command = switch (in.readUnsignedByte()) {
                case NEW -> new NewOrder(in.readUTF(), in.readUTF(), in.readUTF(), Side.values()[in.readUnsignedByte()], OrderType.values()[in.readUnsignedByte()], TimeInForce.values()[in.readUnsignedByte()], in.readLong(), in.readLong(), in.readLong());
                case CANCEL -> new CancelOrder(in.readUTF(), in.readLong(), in.readLong());
                case REPLACE -> new ReplaceOrder(in.readUTF(), in.readUTF(), in.readLong(), in.readLong(), in.readLong(), in.readLong());
                default -> throw new IOException("unknown command type");
            };
            if (in.available() != 0) throw new IOException("command frame contains trailing bytes");
            return command;
        } catch (ArrayIndexOutOfBoundsException invalidEnum) { throw new IOException("invalid command enum", invalidEnum); }
    }
}
