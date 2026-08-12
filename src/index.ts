import assert from "assert";
import { Element, ElementContent, Root } from "hast";
import path from "path";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { FileNamedProcOne } from "webpan/dist/types/processor.js";
import { after, before, first, getByPath, type FileEntry, type TocEntryOrdered } from "wp-dir-toc"
import WProcessor from "webpan/dist/types/processor.js";
import { ProcessorOutputRaw } from "webpan/dist/types/processorStates.js";
import type UnifiedProcessor from "wp-unified";

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
        let absFilePath = this.filePath({ absolute: true });

        // finding dir-toc
        let dirTocHeight = 0;
        let dirTocPath = absFilePath.split("/")
        let dirTocProc: FileNamedProcOne | undefined = undefined;

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

        // try to use first file as current page
        if (content === "dir") {
            const entries = dirTocProcRes.result as TocEntryOrdered;
            const dirToc = getByPath(entries, absFilePath);
            if (dirToc === undefined) return {};
            assert(dirToc.type === "dir");
            const replacement = first(dirToc);
            if (replacement === undefined) return {};

            absFilePath = replacement.sourceAbs;
        }

        let file = this.files({ include: absFilePath, absolute: true }).values().next().value;
        let proc = file?.procs({ include: "unified" }).values().toArray()[0]

        if (proc === undefined)
            throw new Error(`file ${absFilePath} does not have unified attached`)

        let unifiedProc = proc.values().toArray()[0];
        assert(unifiedProc !== undefined)

        let unifiedSettings = unifiedProc.getSettings()
        let stack: any[] = unifiedSettings.stack ?? [];

        let pluginIndex: null | number = null;
        let frontMatterIndex: null | number = null;

        for (const [index, plugin] of stack.map((plugin, index) => [index, plugin])) {
            if (plugin.vpUseAst === true)
                pluginIndex = index;
            if (plugin === "remark-frontmatter" || plugin?.name === "remark-frontmatter")
                frontMatterIndex = index;
        }

        if (pluginIndex === null)
            throw new Error("no unified plugin with property \"vpUseAst\"")

        let unifiedRes: UnifiedProcessor = await unifiedProc.getProcessor() as unknown as UnifiedProcessor
        let snapshot: Root = unifiedRes.getResult(pluginIndex)?.snapshot;

        let parentHeight = 0;
        let parentPath = absFilePath.split("/")
        let resourceProc: FileNamedProcOne | undefined = undefined;

        const frontMatter: Record<string, any> = frontMatterIndex === null ? {} : unifiedRes.getResult(frontMatterIndex)?.result ?? {};

        // finding vitepress resources
        while (parentPath.length > 1) {
            parentPath.pop();
            let path = `${parentPath.join("/")}/`
            resourceProc = this.files({ include: path, absolute: true }).values().next()?.value?.procs({ include: "vitepress-resources" }).get("vitepress-resources")?.values().next().value as unknown as FileNamedProcOne

            if (resourceProc !== undefined)
                break;

            parentHeight++;
        }


        let bookHeight = 0;
        let bookPath = absFilePath.split("/")
        let bookProc: FileNamedProcOne | undefined = undefined;

        // finding yaml-parser
        while (bookPath.length > 1) {
            bookPath.pop();
            let path = `${bookPath.join("/")}/book.yml`
            bookProc = this.files({ include: path, absolute: true }).values().next()?.value?.procs({ include: "yaml-parse" }).get("yaml-parse")?.values().next().value as unknown as FileNamedProcOne

            if (bookProc !== undefined)
                break;

            bookHeight++;
        }

        let bookRes = await bookProc?.getResult();
        if (bookRes === undefined)
            throw new Error("could not find book.yml in parent of current file")

        let bookTitle = bookRes.result.title ?? "Unspecified title";
        
        if(content === "dir") {
            bookHeight--;
            dirTocHeight--;
            parentHeight--;
        }

        let bookRoot = "../".repeat(bookHeight);

        let selectedEntry: undefined | FileEntry;

        const tocSkeleton = (entry: TocEntryOrdered): Element => {
            switch (entry.type) {
                case "file":
                    let filePath = path.parse(path.join("./", "../".repeat(dirTocHeight), entry.sourceRel));

                    let className = ['container']; path.join(absFilePath, path.format(filePath)) === absFilePath
                    if (selectedEntry === undefined && path.join(absFilePath, "../", path.format(filePath)) === absFilePath) {
                        className.push("nav-selected")
                        assert(entry.type === "file");
                        selectedEntry = entry;
                    }

                    filePath.ext = "html";
                    filePath.base = "";

                    return {
                        type: 'element',
                        tagName: 'div',
                        properties: { className },
                        children: [
                            {
                                type: 'element',
                                tagName: 'a',
                                properties: { href: path.format(filePath) },
                                children: [
                                    {
                                        type: 'text',
                                        value: entry.frontMatter?.title ?? path.parse(entry.sourceRel).name,
                                    }
                                ],
                            },
                        ],
                    }
                case "dir":
                    let dirName: string = entry.meta?.title || path.basename(entry.sourceRel);
                    if (dirName.length === 0) dirName = "/";
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
                                                value: dirName,
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

        // strip top level are all dirs
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

        let beforeNext: Element[] = [];

        if (selectedEntry) {
            function urlOfEntry(entry: FileEntry): string {
                let filePath = path.parse(path.join("./", "../".repeat(dirTocHeight), entry.sourceRel));
                filePath.ext = "html";
                filePath.base = "";
                return path.format(filePath);
            }

            let beforeNextElem: Element = {
                type: 'element',
                tagName: 'div',
                properties: { className: ['vp-beforenext'] },
                children: []
            }

            const prev = before(dirTocProcRes.result, selectedEntry);
            if (prev) {
                beforeNextElem.children.push(
                    {
                        type: 'element',
                        tagName: 'a',
                        properties: { className: ['vp-beforebox'], href: urlOfEntry(prev) },
                        children: [
                            {
                                type: 'element',
                                tagName: 'div',
                                properties: { className: ['vp-before-title'] },
                                children: [
                                    {
                                        type: 'text',
                                        value: `Previous page`,
                                    },
                                ],
                            },
                            {
                                type: 'element',
                                tagName: 'div',
                                properties: { className: ['vp-before-name'] },
                                children: [
                                    {
                                        type: 'text',
                                        value: prev.meta?.title ?? path.parse(prev.sourceRel).name,
                                    },
                                ],
                            }
                        ],
                    }
                )
            }

            const succ = after(dirTocProcRes.result, selectedEntry);
            if (succ) {
                if (prev === undefined) beforeNextElem.children.push({ type: 'element', tagName: 'div', properties: {}, children: [] })
                beforeNextElem.children.push(
                    {
                        type: 'element',
                        tagName: 'a',
                        properties: { className: ['vp-afterbox'], href: urlOfEntry(succ) },
                        children: [
                            {
                                type: 'element',
                                tagName: 'div',
                                properties: { className: ['vp-after-title'] },
                                children: [
                                    {
                                        type: 'text',
                                        value: `Next page`,
                                    },
                                ],
                            },
                            {
                                type: 'element',
                                tagName: 'div',
                                properties: { className: ['vp-after-name'] },
                                children: [
                                    {
                                        type: 'text',
                                        value: succ.meta?.title ?? path.parse(succ.sourceRel).name,
                                    },
                                ],
                            }
                        ],
                    }
                )
            }

            if (prev || succ) {
                beforeNext = [beforeNextElem]
            }
        }

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
                                    children: [
                                        {
                                            type: 'text',
                                            value: frontMatter.title ?? "No title",
                                        }
                                    ],
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
                                    properties: { id: 'vp-mobile-backdrop' },
                                    children: []
                                },
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
                                                    tagName: 'div',
                                                    properties: { className: ['vp-sidebar-topbar'] },
                                                    children:
                                                        [

                                                            {
                                                                type: 'element',
                                                                tagName: 'a',
                                                                properties: { href: bookRoot },
                                                                children: [
                                                                    {
                                                                        type: 'text',
                                                                        value: bookTitle,
                                                                    }
                                                                ],
                                                            }
                                                        ],
                                                },
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
                                                    tagName: 'div',
                                                    properties: { className: ['vp-doc-topbar'] },
                                                    children:
                                                        [

                                                            {
                                                                type: 'element',
                                                                tagName: 'a',
                                                                properties: { href: bookRoot, className: ['vp-doc-topbar-title'] },
                                                                children: [
                                                                    {
                                                                        type: 'text',
                                                                        value: bookTitle,
                                                                    }
                                                                ],
                                                            }
                                                        ],
                                                },
                                                {
                                                    type: 'element',
                                                    tagName: 'div',
                                                    properties: { className: ['vp-doc-mobile-bar'] },
                                                    children:
                                                        [

                                                            {
                                                                type: 'element',
                                                                tagName: 'div',
                                                                properties: { id: 'vp-mobile-toc-button' },
                                                                children: [
                                                                    {
                                                                        type: 'text',
                                                                        value: "Table of contents",
                                                                    }
                                                                ],
                                                            }
                                                        ],
                                                },
                                                {
                                                    type: 'element',
                                                    tagName: 'div',
                                                    properties: { className: ['vp-doc'] },
                                                    children: [
                                                        {
                                                            type: 'element',
                                                            tagName: 'main',
                                                            properties: { className: ['vp-doc-content'] },
                                                            children: structuredClone(snapshot.children) as ElementContent[],
                                                        },
                                                        ...beforeNext
                                                    ]
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

        let outPath = content === "dir" ? "index.html" : runRename(`${this.settings().output}`, this.filePath());

        return {
            relative: new Map([[outPath, { buffer: output, priority: this.settings().priority ?? 100 }]]),
        }
    }
}
