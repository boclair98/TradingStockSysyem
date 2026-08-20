import { NEXTRADE_INSTRUMENTS } from "../../../engine/instrumentMaster";

export async function GET() {
  return Response.json({
    venue: "NEXTRADE",
    instruments: NEXTRADE_INSTRUMENTS.map(({ displayName, mark, ...instrument }) => ({
      ...instrument,
      displayName,
      mark,
    })),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
