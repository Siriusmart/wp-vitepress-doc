import assert from "assert";
import path from "path";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { after, before, first, getByPath } from "wp-dir-toc";
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
        let absFilePath = this.filePath({ absolute: true });
        // directory the output page lives in, kept separate because absFilePath
        // gets redirected to the first article when building a directory index
        const pageDir = content === "dir"
            ? path.join(absFilePath, "/")
            : path.join(absFilePath, "../");
        // finding dir-toc
        let dirTocHeight = 0;
        let dirTocPath = absFilePath.split("/");
        let dirTocProc = undefined;
        while (dirTocPath.length > 1) {
            dirTocPath.pop();
            let tryPath = path.join(dirTocPath.join("/"), "/");
            dirTocProc = this.files({ include: tryPath, absolute: true }).values().next()?.value?.procs({ include: "dir-toc" }).get("dir-toc")?.values().next().value;
            if (dirTocProc !== undefined)
                break;
            dirTocHeight++;
        }
        let dirTocProcRes = await dirTocProc?.getResult();
        if (dirTocProcRes === undefined)
            throw new Error("could not find dir-toc in parent of current file");
        // try to use first file as current page
        if (content === "dir") {
            const entries = dirTocProcRes.result;
            // getByPath only looks at descendants, so the dir-toc root has to be matched here
            const dirToc = entries.sourceAbs === pageDir ? entries : getByPath(entries, absFilePath);
            if (dirToc === undefined)
                return {};
            assert(dirToc.type === "dir");
            const replacement = first(dirToc);
            if (replacement === undefined)
                return {};
            absFilePath = replacement.sourceAbs;
        }
        let file = this.files({ include: absFilePath, absolute: true }).values().next().value;
        let proc = file?.procs({ include: "unified" }).values().toArray()[0];
        if (proc === undefined)
            throw new Error(`file ${absFilePath} does not have unified attached`);
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
        let parentPath = pageDir.split("/");
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
        let bookHeight = 0;
        let bookPath = pageDir.split("/");
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
        let bookRoot = bookHeight === 0 ? "./" : "../".repeat(bookHeight);
        let selectedEntry;
        const tocSkeleton = (entry) => {
            switch (entry.type) {
                case "file":
                    let filePath = path.parse(path.join("./", "../".repeat(dirTocHeight), entry.sourceRel));
                    let className = ['container'];
                    if (selectedEntry === undefined && path.join(pageDir, path.format(filePath)) === absFilePath) {
                        className.push("nav-selected");
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
                    };
                case "dir":
                    let dirName = entry.meta?.title || path.basename(entry.sourceRel);
                    if (dirName.length === 0)
                        dirName = "/";
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
                    };
            }
        };
        let entries = dirTocProcRes.result;
        let navElem;
        // strip top level are all dirs
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
        let beforeNext = [];
        if (selectedEntry) {
            function urlOfEntry(entry) {
                let filePath = path.parse(path.join("./", "../".repeat(dirTocHeight), entry.sourceRel));
                filePath.ext = "html";
                filePath.base = "";
                return path.format(filePath);
            }
            let beforeNextElem = {
                type: 'element',
                tagName: 'div',
                properties: { className: ['vp-beforenext'] },
                children: []
            };
            const prev = before(dirTocProcRes.result, selectedEntry);
            if (prev) {
                beforeNextElem.children.push({
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
                });
            }
            const succ = after(dirTocProcRes.result, selectedEntry);
            if (succ) {
                if (prev === undefined)
                    beforeNextElem.children.push({ type: 'element', tagName: 'div', properties: {}, children: [] });
                beforeNextElem.children.push({
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
                });
            }
            if (prev || succ) {
                beforeNext = [beforeNextElem];
            }
        }
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
                                                    tagName: 'div',
                                                    properties: { className: ['vp-doc'] },
                                                    children: [
                                                        {
                                                            type: 'element',
                                                            tagName: 'main',
                                                            properties: { className: ['vp-doc-content'] },
                                                            children: structuredClone(snapshot.children),
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
        let outPath = content === "dir" ? path.join(this.filePath(), "index.html") : runRename(`${this.settings().output}`, this.filePath());
        return {
            relative: new Map([[outPath, { buffer: output, priority: this.settings().priority ?? 100 }]]),
        };
    }
}
//# sourceMappingURL=index.js.map