import { handleMcp } from "../../../src/server/mcp/http";

/**
 * POST /mcp/<owner key>: the same server for connectors that cannot send a header. The URL is the secret:
 * it goes through the same lockout as a bearer key, and nothing here logs the path.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ key: string }> };
const handle = async (request: Request, { params }: Ctx) => handleMcp(request, { pathKey: (await params).key });

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
