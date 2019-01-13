const enum NodeType {
	Element = 1,
	Text = 3,
	Comment = 8
}


interface NodeList {
    readonly length: number;
    readonly [index: number]: Node;
}


export type Fragment = (parent: Node, seg: Segment) => Segment;

type Arg = any;
type Patch = (args: ReadonlyArray<Arg>, off: number) => number; // returns the new offset


interface Template {
	readonly elem: HTMLTemplateElement;
	readonly ph: Placeholder;
}

interface Placeholder {
	readonly path: Array<number>; // relative to the parent placeholder
	readonly createPatch: (n: Node, tmpl: Template) => Patch;
	readonly children: Array<Placeholder>;
}

interface Segment {
	readonly tmpl?: Template;
	readonly patches: ReadonlyArray<Patch>;
	readonly nodes: NodeList;
}

interface Attribute {
	readonly name: string;
	readonly pieces: ReadonlyArray<string>;
}


const templates = new WeakMap<TemplateStringsArray, Template>(); // literal strings => template
const segments = new WeakMap<Node, Segment>();                   // parent node => segment
const textTemplate: Template = {
	elem: createTemplateElement(" "),
	ph: {path: [], createPatch: null, children: []},
};


export function dom(strings: TemplateStringsArray, ...args: Array<Arg>): Fragment {
	let tmpl = templates.get(strings);
	if(!tmpl) {
		templates.set(strings, tmpl = createTemplate(strings));
	}

	return (parent: Node, seg: Segment): Segment => {
		if(seg.tmpl === tmpl) {
			patch(seg, args);
		} else {
			const oldNodes = seg.nodes;
			seg = instantiate(parent.ownerDocument, tmpl);
			patch(seg, args);
			if(seg.nodes.length) {
				// The parent node of all seg.nodes is the HTML document fragment
				// which was created from the template. Adding it to the tree adds
				// the children only.
				replaceNodes(parent, seg.nodes[0].parentNode, oldNodes);
			} else {
				removeNodes(oldNodes, 0);
			}
		}
		return seg;
	};
}

export function text(s: string): Fragment {
	return (parent: Node, seg: Segment): Segment => {
		if(seg.tmpl !== textTemplate) {
			const n = parent.ownerDocument.createTextNode(s);
			replaceNodes(parent, n, seg.nodes);
			seg = {
				tmpl: textTemplate,
				patches: [],
				nodes: [n],
			};
		} else if(seg.nodes[0].nodeValue !== s) {
			seg.nodes[0].nodeValue = s;
		}
		return seg;
	};
}

export function render(f: Fragment, parent: Node): void {
	segments.set(parent, f(parent, segments.get(parent) || {patches: [] as Array<Patch>, nodes: parent.childNodes}));
}


function patch(seg: Segment, args: ReadonlyArray<Arg>): void {
	seg.patches.reduce((off, p) => p(args, off), 0);
}

function instantiate(doc: Document, tmpl: Template): Segment {
	const seg = doc.importNode(tmpl.elem.content, true);
	const patches: Array<Patch> = [];
	const walk = (ph: Placeholder, p: Node): void => {
		const n = ph.path.reduce((child, i) => child.childNodes[i], p);
		patches.push(ph.createPatch(n, tmpl));
		ph.children.forEach(c => walk(c, n));
	}

	tmpl.ph.children.forEach(ph => walk(ph, seg));
	return {tmpl, patches, nodes: Array.from(seg.childNodes)};
}

function createTemplate(strings: TemplateStringsArray): Template {
	let html = strings[0];
	strings.slice(1).forEach((s, i) => {
		const k = i.toString();
		html += `<!--__#${"0".repeat(8-k.length)}${k}-->` + s;
	});

	const elem = createTemplateElement(html);
	const walk = (root: Node, parent: Placeholder, path: ReadonlyArray<number>): void => {
		for(let i = 0; i < root.childNodes.length; ++i) {
			const n = root.childNodes[i];
			let ph = parent, p = path.slice();
			p.push(i);

			switch(n.nodeType) {
			case NodeType.Element:
				const attrmap: {[k: string]: Attribute} = {};
				for(let a = (n as Element).attributes, i = a.length - 1; i >= 0; --i) {
					const v = a[i].nodeValue;
					const p = v.split(/<!--__#\d+-->/);
					if(p.length > 1) {
						attrmap[v.slice(p[0].length + 7)] = {
							name: a[i].nodeName,
							pieces: p,
						};
						a[i].nodeValue = "";
					}
				}

				const keys = Object.keys(attrmap);
				if(keys.length) {
					const attrs = keys.sort().map(k => attrmap[k]);
					attrs.forEach(attr => attr.name.startsWith("on") && (n as Element).removeAttribute(attr.name));
					parent.children.push(ph = {
						path: p,
						createPatch: attributePatch.bind(null, attrs),
						children: [],
					});
					p = [];
				}
				break;

			case NodeType.Comment:
				if(/__#\d+/.test(n.textContent)) {
					parent.children.push({
						path: p,
						createPatch: nodePatch,
						children: [],
					});
				}
				break;
			}

			walk(n, ph, p);
		}
	}

	const ph: Placeholder = {
		path: [],
		createPatch: null,
		children: [],
	};
	walk(elem.content, ph, []);
	return {elem, ph};
}

function createTemplateElement(html: string): HTMLTemplateElement {
	const elem = document.createElement("template");
	elem.innerHTML = html;
	elem.content.normalize();
	return elem;
}

function attributePatch(attrs: ReadonlyArray<Attribute>, n: Node, tmpl: Template): Patch {
	// Here we always get a single node: the node whose attribute
	// should be changed.

	const handlers: {[eventType: string]: Arg} = {};

	return (args: ReadonlyArray<Arg>, off: number): number => {
		attrs.forEach(attr => {
			const varOnly = attr.pieces.length < 3 && !attr.pieces.join("").trim().length;
			if(varOnly && attr.name.startsWith("on")) {
				// event listener
				const typ = attr.name.slice(2); // trim "on"
				const h = args[off++];
				if(h !== handlers[typ]) {
					n.removeEventListener(typ, handlers[typ]);
					n.addEventListener(typ, h);
					handlers[typ] = h;
				}
			} else if(varOnly && typeof args[off] === "boolean") {
				// boolean attribute
				args[off++]
					? (n as Element).setAttribute(attr.name, "")
					: (n as Element).removeAttribute(attr.name);
			} else {
				// string attribute
				(n as Element).setAttribute(attr.name, attr.pieces.reduce((res, piece) => res + args[off++] + piece));
			}
		});
		return off;
	};
}

function nodePatch(n: Node, tmpl: Template): Patch {
	// Here we always get a single argument: the value which shall replace the
	// given nodes.

	interface Part {
		arg: Arg;
		seg: Segment;
	}

	const parent = n.parentNode;
	const parts: Array<Part> = [{arg: null, seg: {tmpl, patches: [], nodes: [n]}}];

	return (args: ReadonlyArray<Arg>, off: number): number => {
		const newArgs = Array.isArray(args[off]) ? args[off] : [args[off]];
		let idx = 0;
		newArgs.forEach((arg: Arg) => {
			const part = parts[idx] || {arg: null, seg: {tmpl: null, patches: [], nodes: []}};
			if(arg !== part.arg) {
				// We assume a function to be a representation here, since
				// passing functions as child nodes wouldn't make sense.
				const r = typeof arg === "function" ? arg : text("" + arg);
				part.arg = arg;
				part.seg = r(parent, part.seg);
				parts[idx] = part;
			}
			++idx;
		});

		// remove old nodes
		for(; idx < parts.length; ++idx) {
			parts[idx].seg && removeNodes(parts[idx].seg.nodes, 0);
		}
		parts.length = newArgs.length;
		return off + 1;
	};
}

function removeNodes(nodes: NodeList, start: number): void {
	for(let i = nodes.length; i > start;) {
		--i;
		nodes[i].parentNode.removeChild(nodes[i]);
	}
}

function replaceNodes(parent: Node, newChild: Node, oldChildren: NodeList): void {
	if(oldChildren.length) {
		removeNodes(oldChildren, 1);
		parent.replaceChild(newChild, oldChildren[0]);
	} else {
		parent.appendChild(newChild);
	}
}
