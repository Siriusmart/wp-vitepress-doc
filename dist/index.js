"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const webpan = require("webpan");
class VitepressDocProcessor extends webpan.Processor {
    async build(content) {
        if (content === "dir")
            return {};
        let file = this.files({ include: this.filePath() }).values().next().value;
        let proc = file?.procs({ include: "unified" }).values().toArray()[0];
        if (proc === undefined)
            throw new Error(`file ${this.filePath()} does not have unified attached`);
        let unifiedProc = proc.values().toArray()[0];
        assert(unifiedProc !== undefined);
        let unifiedSettings = unifiedProc.getSettings();
        let stack = unifiedSettings.stack ?? [];
        let pluginIndex = null;
        for (const [index, plugin] of stack.map((plugin, index) => [index, plugin]).reverse()) {
            if (plugin.vpUseAst === true)
                pluginIndex = index;
        }
        if (pluginIndex === null)
            throw new Error("no unified plugin with property \"vpUseAst\"");
        let unifiedRes = await unifiedProc.getProcessor();
        let snapshot = unifiedRes.getResult(pluginIndex)?.snapshot;
        console.log(snapshot);
        return {};
    }
}
exports.default = VitepressDocProcessor;
//# sourceMappingURL=index.js.map