---
title: Round-trip Corpus
tags: [spike, markdown, fidelity]
author: spike
---

# Heading One

## Heading Two

### Heading Three

A paragraph with **bold**, *italic*, ~~strike~~, and `inline code`. Here is a
[link to example](https://example.com). Now a mid-paragraph comment
<span data-c="abc123">flagged phrase</span> that must survive intact.

Bold wrapping a comment: **prefix <span data-c="bold01">inside bold</span> suffix**.

## Lists

- Bullet level one
  - Bullet level two
    - Bullet level three
- Second top bullet with a comment <span data-c="list01">span in a list item</span> here

1. Numbered one
2. Numbered two
   1. Numbered two-one
   2. Numbered two-two
      1. Numbered two-two-one
3. Numbered three

## Task List

- [ ] Unchecked task
- [x] Checked task
- [ ] Task with a comment <span data-c="task01">flagged</span>

## Code Block

```js
function greet(name) {
  return `hello ${name}`;
}
```

```python
def greet(name):
    return f"hello {name}"
```

## Table

| Left | Center | Right |
| :--- | :----: | ----: |
| a1   | b1     | c1    |
| a2   | b2     | c2    |

## Blockquote

> A quoted line.
> A second quoted line.

## Horizontal Rule

---

## Image

![alt text](https://example.com/image.png)
