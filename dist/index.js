import assert from "assert";
import path from "path";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import WProcessor from "webpan/dist/types/processor.js";
function runRename(expr, pathToProccess) {
    function ext(newExt) {
        return (pathAny) => {
            let parsed = path.parse(pathAny);
            return path.format({
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
export default class VitepressDocProcessor extends WProcessor {
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
        let frontMatterIndex = null;
        for (const [index, plugin] of stack.map((plugin, index) => [index, plugin])) {
            if (plugin.vpUseAst === true)
                pluginIndex = index;
            if (plugin === "remark-frontmatter" || plugin?.name === "remark-frontmatter")
                frontMatterIndex = index;
        }
        if (pluginIndex === null)
            throw new Error("no unified plugin with property \"vpUseAst\"");
        let unifiedRes = await unifiedProc.getProcessor();
        let snapshot = unifiedRes.getResult(pluginIndex)?.snapshot;
        let parentHeight = 0;
        let parentPath = this.filePath({ absolute: true }).split("/");
        let resourceProc = undefined;
        const frontMatter = frontMatterIndex === null ? {} : unifiedRes.getResult(frontMatterIndex)?.result ?? {};
        // finding vitepress resources
        while (parentPath.length > 1) {
            parentPath.pop();
            let path = `${parentPath.join("/")}/`;
            resourceProc = this.files({ include: path, absolute: true }).values().next()?.value?.procs({ include: "vitepress-resources" }).get("vitepress-resources")?.values().next().value;
            if (resourceProc !== undefined)
                break;
            parentHeight++;
        }
        let dirTocHeight = 0;
        let dirTocPath = this.filePath({ absolute: true }).split("/");
        let dirTocProc = undefined;
        // finding dir-toc
        while (dirTocPath.length > 1) {
            dirTocPath.pop();
            let path = `${dirTocPath.join("/")}/`;
            dirTocProc = this.files({ include: path, absolute: true }).values().next()?.value?.procs({ include: "dir-toc" }).get("dir-toc")?.values().next().value;
            if (dirTocProc !== undefined)
                break;
            dirTocHeight++;
        }
        let dirTocProcRes = await dirTocProc?.getResult();
        if (dirTocProcRes === undefined)
            throw new Error("could not find dir-toc in parent of current file");
        let bookHeight = 0;
        let bookPath = this.filePath({ absolute: true }).split("/");
        let bookProc = undefined;
        // finding yaml-parser
        while (bookPath.length > 1) {
            bookPath.pop();
            let path = `${bookPath.join("/")}/book.yml`;
            bookProc = this.files({ include: path, absolute: true }).values().next()?.value?.procs({ include: "yaml-parse" }).get("yaml-parse")?.values().next().value;
            if (bookProc !== undefined)
                break;
            bookHeight++;
        }
        let bookRes = await bookProc?.getResult();
        if (bookRes === undefined)
            throw new Error("could not find book.yml in parent of current file");
        let bookTitle = bookRes.result.title ?? "Unspecified title";
        let bookRoot = "../".repeat(bookHeight);
        const tocSkeleton = (entry) => {
            switch (entry.type) {
                case "file":
                    let filePath = path.parse(path.join("../".repeat(dirTocHeight), entry.sourceRel));
                    let className = ['container'];
                    path.join(this.filePath({ absolute: true }), path.format(filePath)) === this.filePath({ absolute: true });
                    if (path.join(this.filePath({ absolute: true }), "../", path.format(filePath)) === this.filePath({ absolute: true })) {
                        className.push("nav-selected");
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
                    };
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
                                                value: entry.meta?.title ?? path.basename(entry.sourceRel),
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
                    };
            }
        };
        let entries = dirTocProcRes.result;
        let navElem;
        // strip one layer if top level are all dirs
        if (entries.type === "dir" && entries.children.every(child => child.type === "dir"))
            navElem = entries.children.map(tocSkeleton);
        else
            navElem = [tocSkeleton(entries)];
        function toList(xs) {
            if (xs === undefined)
                return [];
            else if (typeof xs === "string")
                return [xs];
            else
                return xs;
        }
        const settings = this.settings();
        const css = toList(settings.css);
        const js = toList(settings.js);
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
                                };
                            })),
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
                                                    children: [
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
                                                    children: [
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
                                                    children: [
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
                                    properties: { src: `./${"../".repeat(parentHeight)}vp-script.js` },
                                    children: [],
                                },
                            ].concat(js.map(elem => {
                                return {
                                    type: 'element',
                                    tagName: 'script',
                                    properties: { src: elem },
                                    children: [],
                                };
                            })),
                        }
                    ],
                }
            ],
            data: { quirksMode: false },
        };
        let output = unified()
            .use(rehypeStringify, { allowDangerousHtml: true })
            .stringify(outputAst);
        let outPath = runRename(`${this.settings().output}`, this.filePath());
        return {
            relative: new Map([[outPath, { buffer: output, priority: this.settings().priority ?? 0 }]]),
        };
    }
}
//# sourceMappingURL=index.js.map