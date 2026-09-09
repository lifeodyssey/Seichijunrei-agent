import { mapSource } from "../../src/chain";
import atlasSum from "./preflight-three-chain/atlas.sum";
import a from "./preflight-three-chain/20260101000000_baseline.sql";
import b from "./preflight-three-chain/20260102000000_extend.sql";
import c from "./preflight-three-chain/20260103000000_third.sql";

export const productionChain = mapSource(atlasSum, {
  "20260101000000_baseline.sql": a,
  "20260102000000_extend.sql": b,
  "20260103000000_third.sql": c,
});
