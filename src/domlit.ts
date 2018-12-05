const enum NodeType {
	Element = 1,
	Text = 3,
	Comment = 8
}


interface NodeList {
    readonly length: number;
    readonly [index: number]: Node;
}


export type Component = (parent: Node, frag: Fragment) => Fragment;

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

interface Fragment {
	readonly tmpl?: Template;
	readonly patches: ReadonlyArray<Patch>;
	readonly nodes: NodeList;
}

interface Attribute {
	readonly name: string;
	readonly pieces: ReadonlyArray<string>;
}


const templates = new WeakMap<TemplateStringsArray, Template>(); // literal strings => template
const fragments = new WeakMap<Node, Fragment>(); // parent node => fragment
const textTemplate: Template = {
	elem: createTemplateElement(" "),
	ph: {path: [], createPatch: null, children: []},
};


export function dom(strings: TemplateStringsArray, ...args: Array<Arg>): Component {
	let tmpl = templates.get(strings);
	if(!tmpl) {
		templates.set(strings, tmpl = createTemplate(strings));
	}

	return (parent: Node, frag: Fragment): Fragment => {
		if(frag.tmpl === tmpl) {
			patch(frag, args);
		} else {
			const oldNodes = frag.nodes;
			frag = instantiate(parent.ownerDocument, tmpl);
			patch(frag, args);
			if(frag.nodes.length) {
				// The parent node of all frag.nodes is the HTML document fragment
				// which was created from the template. Adding it to the tree, adds
				// the children only.
				replaceNodes(parent, frag.nodes[0].parentNode, oldNodes);
			} else {
				removeNodes(oldNodes, 0);
			}
		}
		return frag;
	};
}

export function text(s: string): Component {
	return (parent: Node, frag: Fragment): Fragment => {
		if(frag.tmpl !== textTemplate) {
			const n = parent.ownerDocument.createTextNode(s);
			replaceNodes(parent, n, frag.nodes);
			frag = {
				tmpl: textTemplate,
				patches: [],
				nodes: [n],
			};
		} else if(frag.nodes[0].nodeValue !== s) {
			frag.nodes[0].nodeValue = s;
		}
		return frag;
	};
}

export function render(c: Component, parent: Node): void {
	fragments.set(parent, c(parent, fragments.get(parent) || {patches: [] as Array<Patch>, nodes: parent.childNodes}));
}


function patch(frag: Fragment, args: ReadonlyArray<Arg>): void {
	frag.patches.reduce((off, p) => p(args, off), 0);
}

function instantiate(doc: Document, tmpl: Template): Fragment {
	const frag = doc.importNode(tmpl.elem.content, true);
	const patches: Array<Patch> = [];
	const walk = (ph: Placeholder, p: Node): void => {
		const n = ph.path.reduce((child, i) => child.childNodes[i], p);
		patches.push(ph.createPatch(n, tmpl));
		ph.children.forEach(c => walk(c, n));
	}

	tmpl.ph.children.forEach(ph => walk(ph, frag));
	return {tmpl, patches, nodes: Array.from(frag.childNodes)};
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
					attrs.forEach(attr => isEventListener(attr) && (n as Element).removeAttribute(attr.name));
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

	interface HandlerMap<Func> { [eventType: string]: Func }

	const listeners: HandlerMap<(e: Event) => void> = {};
	const handlers: HandlerMap<Arg> = {};

	return (args: ReadonlyArray<Arg>, off: number): number => {
		attrs.forEach(attr => {
			if(isEventListener(attr)) {
				const typ = attr.name.slice(2); // trim "on"
				const h = args[off++];
				if(h !== handlers[typ]) {
					const l = (e: Event) => { e.preventDefault(); h(e); };
					n.removeEventListener(typ, listeners[typ]);
					n.addEventListener(typ, l);
					listeners[typ] = l;
					handlers[typ] = h;
				}
			} else {
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
		frag: Fragment;
	}

	const parent = n.parentNode;
	const parts: Array<Part> = [{arg: null, frag: {tmpl, patches: [], nodes: [n]}}];

	return (args: ReadonlyArray<Arg>, off: number): number => {
		const newArgs = Array.isArray(args[off]) ? args[off] : [args[off]];
		let idx = 0;
		newArgs.forEach((arg: Arg) => {
			const part = parts[idx] || {arg: null, frag: {tmpl: null, patches: [], nodes: []}};
			if(arg !== part.arg) {
				// We assume a function to be a component here, since passing functions
				// as child nodes wouldn't make sense.
				const c = typeof arg === "function" ? arg : text("" + arg);
				part.arg = arg;
				part.frag = c(parent, part.frag);
				parts[idx] = part;
			}
			++idx;
		});

		// remove old nodes
		for(; idx < parts.length; ++idx) {
			parts[idx].frag && removeNodes(parts[idx].frag.nodes, 0);
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

function isEventListener(attr: Attribute): boolean {
	return attr.name.startsWith("on") && attr.pieces.length < 3 && !attr.pieces.join("").trim().length;
}

