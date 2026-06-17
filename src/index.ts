import assert from "assert";
import { Element, ElementContent, Root } from "hast";
import path from "path";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { FileNamedProcOne } from "webpan/dist/types/processor.js";
import type { TocEntryOrdered } from "wp-dir-toc"
import WProcessor from "webpan/dist/types/processor.js";
import { ProcessorOutputRaw } from "webpan/dist/types/processorStates.js";
import UnifiedProcessor from "wp-unified";

interface Options {
    css?: string[] | string
    js?: string[] | string
}

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

        let parentHeight = 0;
        let parentPath = this.filePath({ absolute: true }).split("/")
        let resourceProc: FileNamedProcOne | undefined = undefined;

        // finding vitepress resources
        while (parentPath.length > 1) {
            parentPath.pop();
            let path = `${parentPath.join("/")}/`
            resourceProc = this.files({ include: path, absolute: true }).values().next()?.value?.procs({ include: "vitepress-resources" }).get("vitepress-resources")?.values().next().value as unknown as FileNamedProcOne

            if (resourceProc !== undefined)
                break;

            parentHeight++;
        }

        let dirTocHeight = 0;
        let dirTocPath = this.filePath({ absolute: true }).split("/")
        let dirTocProc: FileNamedProcOne | undefined = undefined;

        // finding dir-toc
        while (dirTocPath.length > 1) {
            dirTocPath.pop();
            let path = `${dirTocPath.join("/")}/`
            dirTocProc = this.files({ include: path, absolute: true }).values().next()?.value?.procs({ include: "dir-toc" }).get("dir-toc")?.values().next().value as unknown as FileNamedProcOne

            if (dirTocProc !== undefined)
                break;

            dirTocHeight++;
        }

        let dirTocProcRes = await dirTocProc?.getResult();
        if (dirTocProcRes === undefined)
            throw new Error("could not find dir-toc in parent of current file")

        function tocSkeleton(entry: TocEntryOrdered): Element {
            switch (entry.type) {
                case "file":
                    return {
                        type: 'element',
                        tagName: 'div',
                        properties: { className: ['container'] },
                        children: [
                            {
                                type: 'element',
                                tagName: 'a',
                                properties: { href: '' },
                                children: [
                                    {
                                        type: 'text',
                                        value: path.parse(entry.sourceRel).base,
                                    }
                                ],
                            },
                        ],
                    }
                case "dir":
                    return {
                        type: "element",
                        tagName: "div",
                        properties: { className: ['group'] },
                        children: [
                            {
                                type: 'element',
                                tagName: 'section',
                                properties: { className: ['collapsible'] },
                                children: [
                                    {
                                        type: 'element',
                                        tagName: 'div',
                                        properties: { className: ['nav-section-title'] },
                                        children: [
                                            {
                                                type: 'text',
                                                value: path.parse(entry.sourceRel).base,
                                            }
                                        ],
                                    },
                                    {
                                        type: 'element',
                                        tagName: 'div',
                                        properties: { className: ['nav-section-items'] },
                                        children: entry.children.map(tocSkeleton)
                                    },
                                ],
                            },
                        ]
                    }
            }
        }

        let entries = dirTocProcRes.result as TocEntryOrdered;
        let navElem: Element[];

        // strip one layer if top level are all dirs
        if (entries.type === "dir" && entries.children.every(child => child.type === "dir"))
            navElem = entries.children.map(tocSkeleton)
        else
            navElem = [tocSkeleton(entries)]

        function toList(xs: string[] | string | undefined): string[] {
            if (xs === undefined)
                return []
            else if (typeof xs === "string")
                return [xs]
            else
                return xs
        }

        const settings = this.settings() as Options
        const css = toList(settings.css)
        const js = toList(settings.js)

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
                                    properties: { href: `./${"../".repeat(parentHeight)}vp-styles.css`, rel: ['stylesheet'] },
                                    children: [],
                                },
                            ].concat(css.map(elem => {
                                return {
                                    type: 'element',
                                    tagName: 'link',
                                    properties: { href: elem, rel: ['stylesheet'] },
                                    children: [],
                                }
                            })) as Element[],
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
                                                    children: navElem,
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
                                    properties: { src: `./${"../".repeat(parentHeight)}vp-script.js` },
                                    children: [],
                                },
                            ].concat(js.map(elem => {
                                return {
                                    type: 'element',
                                    tagName: 'script',
                                    properties: { src: elem },
                                    children: [],
                                }
                            })) as Element[],
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
