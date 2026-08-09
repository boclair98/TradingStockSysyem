package kr.tradingstocksysyem.venue;

import java.io.IOException;
import java.nio.file.Path;

import static kr.tradingstocksysyem.venue.VenueTypes.*;

public final class DurableVenueProcessor implements AutoCloseable {
    private final MatchingKernel kernel;
    private final DurableJournal journal;

    public DurableVenueProcessor(Path journalPath, MatchingKernel kernel) throws IOException {
        this.kernel = kernel;
        for (DurableJournal.Frame frame : DurableJournal.readAll(journalPath)) {
            CommandResult result = kernel.process(CommandCodec.decode(frame.payload()));
            if (result.commandSequence() != frame.sequence()) throw new IOException("replay sequence diverged");
        }
        this.journal = new DurableJournal(journalPath);
    }

    public synchronized CommandResult process(Command command) throws IOException {
        long nextSequence = kernel.commandSequence() + 1;
        journal.append(nextSequence, CommandCodec.encode(command));
        CommandResult result = kernel.process(command);
        if (result.commandSequence() != nextSequence) throw new IllegalStateException("kernel sequence diverged after durable append");
        return result;
    }

    public String stateDigest() { return kernel.stateDigest(); }
    public long commandSequence() { return kernel.commandSequence(); }
    @Override public void close() throws IOException { journal.close(); }
}
