'use strict';

// The shared layout (views/header.ejs and views/footer.ejs) and the pages built on it:
//   - a page that opens the layout closes it with the footer (the footer closes the container,
//     starts the icons and ends the document).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const views = fs.readdirSync(VIEWS).filter((name) => name.endsWith('.ejs')).sort();

describe('every page that opens the layout closes it', () => {
  for (const name of views.filter((view) => /include\(\s*'header'/.test(read(VIEWS, view)))) {
    test(name, () => {
      assert.match(read(VIEWS, name), /<%-\s*include\(\s*'footer'\s*\)\s*%>/, `${name} includes the header but not the footer`);
    });
  }
});
