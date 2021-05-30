There are two render modes for elements: block and inline. Block elements will break its children uniformly, whereas inline elements will try to fill as much horizontal space as possible.

inline
```
<datalist id="colors"
  ><option>Blue</option><option>Green</option
  ></datalist
>
```

block
```
<datalist id="colors">
  <option>Blue</option>
  <option>Green</option>
</datalist>
```
The decision to treat one element one way or the other is made based on the name of an attribute (based on a likely incomplete list). 
Block and inline refer to the way elements will be laid out in source code not necessarily how they are rendered in a browser. Most elements that are not treated by browsers as inline elements are treated as block elements (although a browser does not think of them as block elements). This can be done because in the elements context, whitespace has no meaning and it can be used to improve readabiliy. `<select>` would be an example of a element that this formatter treats a block, but a browser renders as `display: inline-block`.

Edge cases that I do not support at the moment. If you think that there are a valid use after all, then please open an issue.
- Dangling spaces are ignored: `foo<span>  </span>bar` will be formatted as `foo<span></span>bar`, prettier-html will format as `foo<span> </span>bar`.
- https://github.com/prettier/prettier/pull/7865
- Smart Quotes: Will always use double quotes for attributes
- img.srcset attribute formatting
- HTML comments inside `<script>`
- `<!-- prettier-ignore -->`
- `<!-- display: block -->` and similar
- `<script>` only supports JS (and not JSON, TS, Markdown, etc...). Unsupported script types are left as is.
- <div>
  Lorem ipsum dolor sit amet, consectetur adipiscing elit, "<strong
  >seddoeiusmod</strong>".
</div>

<span
  ><span><input type="checkbox" /></span></span
>

<div>
  Lorem ipsum dolor sit amet, consectetur adipiscing elit, "<strong
    >seddoeiusmod</strong
  >".
</div>


<div>
  before<object data="horse.wav">
    <param name="autoplay" value="true" />
    <param name="autoplay" value="true" /></object
  >after
</div>