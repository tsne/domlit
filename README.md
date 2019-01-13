# domlit

`domlit` is a minimal dependency-free templating library for JavaScript and TypeScript. It leverages the JavaScript [template literals](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals) to support writing expressive DOM fragments with the help of HTML templates.


## API

### Fragment
The `Fragment` type is the main type of `domlit`. It defines a single DOM fragment, which can be rendered into the DOM tree via the `render` function. A fragment can be seen as an HTML or XML snippet with zero or more variable nodes and attributes.

### dom
The `dom` template tag parses the given literal and returns the corresponding fragment with the template values replaced.

### text
```
text: string -> Fragment
```
The `text` function creates a fragment from a given text. The resulting fragment simply represents a text node with the given string as the value.

### render
```
render: (Fragment, Node) -> void
```
The `render` function places a fragment into the given parent node in the DOM tree. For fragments, that were already used, only the variable parts are updated.


## Components

A component is simply a function that takes a context and returns a DOM fragment with the context bound to it. Components are meant to be composed and to build complex fragments out of much simpler ones. Therefore, `domlit` provides useful functions to make composing easy.

### pullback
```
pullback: (W -> X, Component<X>) -> Component<W>
```
The `pullback` function creates a new component, where the context of the passed component is obtained by the provided function. This function can be used to change the context domain of a component.

### concat
```
concat: (Component<X>, ..., Component<X>) -> Component<X>
```
The `concat` function creates a new component, where all passed components are concatenated. All components need to have the same context domain.


## Example

A rudimentary todo app, where tasks can be added and removed.
 
```js
import {dom, render, concat, pullback} from "domlit";

// actions
const addTasks = action((m, ...tasks) => m.tasks.push(...tasks));
const rmTask = action((m, idx) => m.tasks.splice(idx, 1));

// components
const header = title => dom`<header><h1>${title}</h1><p>my tiny todo app</p></header>`;
const todoItem = (task, idx) => dom`<li><button onclick="${() => rmTask(idx)}">X</button> ${task}</li>`;
const todoList = tasks => dom`<ul>${tasks.map(todoItem)}</ul>`;
const todoForm = defaultTask => dom`
    <form>
        <input id="newtask" placeholder="${defaultTask}"/>
        <button onclick="${e => {
            e.preventDefault();
            addTasks(e.target.form.newtask.value || defaultTask);
        }}">Add</button>
    </form>`;
    
const app = concat(
    pullback(m => m.headline, header),
    pullback(m => "new task", todoForm),
    pullback(m => m.tasks, todoList)
);

// model
const model = {
    headline: "My Tasks",
    tasks: [],
};

function action(f) {
    return (...args) => {
        f(model, ...args);
        render(app(model), document.getElementById("app"));
    };
}


addTasks("important meeting", "fix things");
```
