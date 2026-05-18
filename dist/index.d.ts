import webpan = require("webpan");
import type { ProcessorOutputRaw } from "webpan/dist/types/processorStates";
export default class VitepressDocProcessor extends webpan.Processor {
    build(content: Buffer | "dir"): Promise<ProcessorOutputRaw>;
}
//# sourceMappingURL=index.d.ts.map