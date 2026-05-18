"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const webpan = require("webpan");
const rehype_stringify_1 = __importDefault(require("rehype-stringify"));
const unified_1 = require("unified");
const path_1 = __importDefault(require("path"));
function runRename(expr, pathToProccess) {
    function ext(newExt) {
        return (pathAny) => {
            let parsed = path_1.default.parse(pathAny);
            return path_1.default.format({
                ext: newExt,
                name: parsed.name,
                dir: parsed.dir
            });
        };
    }
    if (/^[a-z0-9]+$/i.test(expr))
        expr = `ext("${expr}")`;
    let f = eval(expr);
    if (typeof f === "function")
        return `${f(pathToProccess)}`;
    else {
        console.warn(`"${expr}" cannot be used as a rename function`);
        return pathToProccess;
    }
}
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
        let outputAst = {
            type: 'root',
            children: [
                { type: 'doctype' },
                {
                    type: 'element',
                    tagName: 'html',
                    properties: { lang: 'en' },
                    children: [
                        {
                            type: 'element',
                            tagName: 'head',
                            properties: {},
                            children: [
                                {
                                    type: 'element',
                                    tagName: 'meta',
                                    properties: { charSet: 'UTF-8' },
                                    children: [],
                                },
                                {
                                    type: 'element',
                                    tagName: 'meta',
                                    properties: {
                                        name: 'viewport',
                                        content: 'width=device-width, initial-scale=1'
                                    },
                                    children: [],
                                },
                                {
                                    type: 'element',
                                    tagName: 'title',
                                    properties: {},
                                    children: [],
                                },
                                {
                                    type: 'element',
                                    tagName: 'link',
                                    properties: { href: 'styles.css', rel: ['stylesheet'] },
                                    children: [],
                                },
                            ],
                        },
                        {
                            type: 'element',
                            tagName: 'body',
                            properties: { className: ['dark'] },
                            children: [
                                {
                                    type: 'element',
                                    tagName: 'div',
                                    properties: { className: ['vp-layout'] },
                                    children: [
                                        {
                                            type: 'element',
                                            tagName: 'aside',
                                            properties: { className: ['vp-sidebar'] },
                                            children: [
                                                {
                                                    type: 'element',
                                                    tagName: 'nav',
                                                    properties: { className: ['vp-sidebar-nav'] },
                                                    children: [],
                                                },
                                            ],
                                        },
                                        {
                                            type: 'element',
                                            tagName: 'div',
                                            properties: { className: ['vp-doc-container'] },
                                            children: [
                                                {
                                                    type: 'element',
                                                    tagName: 'main',
                                                    properties: { className: ['vp-doc'] },
                                                    children: structuredClone(snapshot.children),
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: 'element',
                                    tagName: 'script',
                                    properties: { src: './script.js' },
                                    children: [],
                                },
                            ],
                        }
                    ],
                }
            ],
            data: { quirksMode: false },
        };
        let output = (0, unified_1.unified)()
            .use(rehype_stringify_1.default, { allowDangerousHtml: true })
            .stringify(outputAst);
        let outPath = runRename(`${this.settings().output}`, this.filePath());
        return {
            relative: new Map([[outPath, { buffer: output, priority: this.settings().priority ?? 0 }]]),
        };
    }
}
exports.default = VitepressDocProcessor;
//# sourceMappingURL=index.js.map