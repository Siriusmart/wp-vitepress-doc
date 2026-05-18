import assert = require("assert")
import webpan = require("webpan")
import type { ProcessorOutputRaw } from "webpan/dist/types/processorStates";
import type UnifiedProcessor from "wp-unified"

export default class VitepressDocProcessor extends webpan.Processor {
    async build(content: Buffer | "dir"): Promise<ProcessorOutputRaw> {
        if (content === "dir") return {}

        let file = this.files({ include: this.filePath() }).values().next().value;
        let proc = file?.procs({ include: "unified" }).values().toArray()[0]

        if (proc === undefined)
            throw new Error(`file ${this.filePath()} does not have unified attached`)

        let unifiedProc = proc.values().toArray()[0];
        assert(unifiedProc !== undefined)

        let unifiedSettings = unifiedProc.getSettings()
        let stack: any[] = unifiedSettings.stack ?? [];

        let pluginIndex: null | number = null;

        for (const [index, plugin] of stack.map((plugin, index) => [index, plugin]).reverse()) {
            if (plugin.vpUseAst === true)
                pluginIndex = index;
        }

        if(pluginIndex === null)
            throw new Error("no unified plugin with property \"vpUseAst\"")

        let unifiedRes: UnifiedProcessor = await unifiedProc.getProcessor() as UnifiedProcessor
        let snapshot = unifiedRes.getResult(pluginIndex)?.snapshot;
        console.log(snapshot)

        return {}
    }
}
