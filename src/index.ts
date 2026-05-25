import assert from "assert";
import { ElementContent, Root } from "hast";
import path from "path";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import WProcessor from "webpan/dist/types/processor.js";
import { ProcessorOutputRaw } from "webpan/dist/types/processorStates.js";
import UnifiedProcessor from "wp-unified";

function runRename(expr: string, pathToProccess: string) {
    function ext(newExt: string) {
        return (pathAny: string) => {
            let parsed = path.parse(pathAny)
            return path.format({
                ext: newExt,
                name: parsed.name,
                dir: parsed.dir
            })
        }
    }

    if (/^[a-z0-9]+$/i.test(expr))
        expr = `ext("${expr}")`

    let f = eval(expr);

    if (typeof f === "function")
        return `${f(pathToProccess)}`
    else {
        console.warn(`"${expr}" cannot be used as a rename function`);
        return pathToProccess
    }
}

export default class VitepressDocProcessor extends WProcessor {
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

        if (pluginIndex === null)
            throw new Error("no unified plugin with property \"vpUseAst\"")

        let unifiedRes: UnifiedProcessor = await unifiedProc.getProcessor() as unknown as UnifiedProcessor
        let snapshot: Root = unifiedRes.getResult(pluginIndex)?.snapshot;

        let outputAst: Root = {
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
                                                    children: structuredClone(snapshot.children) as ElementContent[],
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
        }

        let output = unified()
            .use(rehypeStringify, { allowDangerousHtml: true })
            .stringify(outputAst)

        let outPath = runRename(`${this.settings().output}`, this.filePath());

        return {
            relative: new Map([[outPath, { buffer: output, priority: this.settings().priority ?? 0 }]]),
        }
    }
}
