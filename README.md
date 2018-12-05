# domlit

`domlit` is a minimal dependency-free templating library for JavaScript and TypeScript. It leverages the JavaScript [template literals](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals) to support writing expressive components with the help of HTML templates.

## API

### Component
The `Component` type is the main type of `domlit`. It defines a single component the library is able to create. A component can be rendered via the `render` function.

### dom
`dom` is a template tag which parses the given literal and returns the corresponding component.

### text(s: string): Component
`text` defines a function which creates a component from a given text. Its resulting component simply represents a text node.

### render(c: Component, parent: Node): void
`render` places a component into the given parent node and attaches it to the DOM tree.

## Example
```js
import {dom, render} from "domlit";

// define some components
const bulletedItem = item => dom`<li>${item}</li>`;
const bulletPoints = items => dom`<ul>${items.map(bulletedItem)}<ul>`;
const todoList = (name, items) => dom`<h1>TODO: ${name}</h1>${bulletPoints(items)}`;

// render components into nodes
render(todoList("Work", ["Fix things", "Lunch", "Important meeting"]), document.getElementById("todo-work"));
render(todoList("Home", ["Netflix", "Chill"]), document.getElementById("todo-home"));
```
