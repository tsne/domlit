import {dom, Fragment} from "./dom";



export interface Component<X> {
	(x: X): Fragment;
}


export const pullback = <W, X>(f: (w: W) => X, c: Component<X>): Component<W> =>
	(w: W): Fragment => c(f(w));

export const concat = <X>(...comps: Array<Component<X>>): Component<X> =>
	(x: X): Fragment => dom` ${comps.map(c => c(x))} `;
