package kr.tradingstocksysyem.venue;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.CRC32C;

public final class DurableJournal implements AutoCloseable {
    private static final int MAGIC = 0x54535359;
    private static final short VERSION = 1;
    private static final int HEADER_SIZE = Integer.BYTES + Short.BYTES + Short.BYTES + Long.BYTES + Integer.BYTES;
    private static final int TRAILER_SIZE = Integer.BYTES;
    private static final int MAX_PAYLOAD = 1_048_576;
    public record Frame(long sequence, byte[] payload) {}

    private final FileChannel channel;

    public DurableJournal(Path path) throws IOException {
        Path parent = path.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);
        channel = FileChannel.open(path, StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND);
    }

    public synchronized void append(long sequence, byte[] payload) throws IOException {
        if (sequence <= 0) throw new IllegalArgumentException("sequence must be positive");
        if (payload.length == 0 || payload.length > MAX_PAYLOAD) throw new IllegalArgumentException("invalid payload length");
        ByteBuffer frame = ByteBuffer.allocate(HEADER_SIZE + payload.length + TRAILER_SIZE);
        frame.putInt(MAGIC).putShort(VERSION).putShort((short) 0).putLong(sequence).putInt(payload.length).put(payload);
        CRC32C crc = new CRC32C();
        crc.update(frame.array(), 0, HEADER_SIZE + payload.length);
        frame.putInt((int) crc.getValue()).flip();
        while (frame.hasRemaining()) channel.write(frame);
        channel.force(true);
    }

    public static List<Frame> readAll(Path path) throws IOException {
        List<Frame> frames = new ArrayList<>();
        if (!Files.exists(path)) return frames;
        try (FileChannel input = FileChannel.open(path, StandardOpenOption.READ)) {
            long expectedSequence = 1;
            while (input.position() < input.size()) {
                ByteBuffer header = ByteBuffer.allocate(HEADER_SIZE);
                readFully(input, header, "partial journal header");
                header.flip();
                int magic = header.getInt(); short version = header.getShort(); header.getShort(); long sequence = header.getLong(); int length = header.getInt();
                if (magic != MAGIC || version != VERSION) throw new IOException("journal header mismatch");
                if (sequence != expectedSequence++) throw new IOException("journal sequence gap at " + sequence);
                if (length <= 0 || length > MAX_PAYLOAD) throw new IOException("invalid journal payload length");
                ByteBuffer body = ByteBuffer.allocate(length + TRAILER_SIZE);
                readFully(input, body, "partial journal payload"); body.flip();
                byte[] payload = new byte[length]; body.get(payload); int expectedCrc = body.getInt();
                CRC32C crc = new CRC32C(); crc.update(header.array()); crc.update(payload);
                if ((int) crc.getValue() != expectedCrc) throw new IOException("journal CRC mismatch at sequence " + sequence);
                frames.add(new Frame(sequence, payload));
            }
        }
        return frames;
    }

    private static void readFully(FileChannel channel, ByteBuffer target, String error) throws IOException {
        while (target.hasRemaining()) if (channel.read(target) < 0) throw new EOFException(error);
    }

    @Override public void close() throws IOException { channel.close(); }
}
