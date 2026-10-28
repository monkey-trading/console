#!/usr/bin/env python3
"""Tests for check-docs.py: each case builds a git repository and runs the check in it."""

import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check-docs.py")
# Keeps the machine's git configuration and its global excludes file out of the runs.
ENV = {
    **os.environ,
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_COUNT": "1",
    "GIT_CONFIG_KEY_0": "core.excludesFile",
    "GIT_CONFIG_VALUE_0": os.devnull,
}
INDEX_LINKS = {"AGENTS.md": "agents/AGENTS.md", "CLAUDE.md": "agents/AGENTS.md"}

INDEX = r"""# Index

[rule](rules/a.md), [anchor](#index), [section](rules/a.md#rule), [folder](rules/),
[wrapped
text](rules/a.md), ![logo](logo.svg "Logo"), [web](https://example.com), [mail](mailto:a@b.c),
[spaced](<rules/b c.md>), [encoded](rules/b%20c.md), [up](../README.md), [root](../),
[`code`](rules/a.md), [rooted](/LICENSE), [network](//example.com/missing.md),
[parens](rules/c(1).md), [escaped](rules/c\(1\).md), [titled](rules/a.md (Rule)),
[single](rules/a.md 'Title'), [a \] bracket](rules/a.md), \[escaped bracket\](missing.md),
[![badge](logo.svg)](rules/a.md) ([in parentheses](rules/a.md)).
An escaped backslash leaves the bracket open: \\[double backslash](rules/a.md).
Inline code is prose: `[inline code](rules/a.md)` and ```[triple](rules/a.md)``` count.

[label]: rules/a.md
[wrapped label]:
  rules/a.md
[angle label]: <rules/b c.md>
[titled label]: rules/a.md "A ` in a title"
[^note]: A footnote, not a link.

```[opens no fence](rules/a.md)``` since its info string holds a backtick.

Prose with ``` inside opens no fence, so [after prose](rules/a.md) counts.

```sh
[fenced](missing.md)
```

~~~
[tilde](missing.md)
~~~

````md
```sh
[nested](missing.md)
```
````

```
> [quoted in a fence](missing.md)
```

- ```md
  [fenced in a list](missing.md)
  ```

1. ```sh
   [ordered fence](missing.md)
   ```

> ~~~
> [fenced in a quote](missing.md)
> ~~~

- > ~~~md
  > [quote fence in a list](missing.md)
  > ~~~
  > [after the quote fence in a list](rules/a.md)

> - ```
>   [list fence in a quote](missing.md)
>   ```

- a
  - b

    ```
    [nested list fence](missing.md)
    ```

> [quoted label]: rules/a.md

- [listed label]: rules/a.md

- ```sh
  [list fence left open](missing.md)

[after the list fence](rules/a.md)

> ```sh
> [quote fence left open](missing.md)

[after the quote fence](rules/a.md)

Prose ends where a fence begins:
~~~
[interrupting fence](missing.md)
~~~

- A fenced block keeps its list item across a blank line:
  ```

  [blank line in a list fence](missing.md)
  ```

- A fence ends a list item's paragraph.
```
[fence after a list item](missing.md)
```

- A block quote ends a list item.
> quote
  ```
[top-level fence after a quote](missing.md)
  ```

> A list item ends a block quote.
- ```
  [list fence after a quote](missing.md)
  ```

- Each break ends a list item.
***
  ```
[top-level fence after a break](missing.md)
  ```

- item
---
  ```
[after a dashed break](missing.md)
  ```

- item
___
  ```
[after an underscored break](missing.md)
  ```

- - -
  ```
[after a spaced break](missing.md)
  ```

- A break leaves no paragraph open.
  ***
[after a break in an item](rules/a.md)
  ```
[fence after an item's break](missing.md)
  ```

> - A blank line ends a block quote and its list item.

> text
>   ```
> [quote fence after a blank line](missing.md)
>   ```

- A blank line leaves no paragraph open.

[after a blank line](rules/a.md)
  ```
[fence after a blank line](missing.md)
  ```
"""

# Thirty-seven relative links in six pages: the index's thirty-five, the README's, and one in a
# page read through its symlink. The ignored and the out-of-scope pages are not read.
VALID = {
    ".gitignore": "/agents/.processes/\n",
    "LICENSE": "",
    "README.md": "[index](agents/AGENTS.md)\n",
    "agents/AGENTS.md": INDEX,
    "agents/logo.svg": "",
    "agents/rules/a.md": "# Rule\n",
    "agents/rules/b c.md": "",
    "agents/rules/c(1).md": "",
    "agents/.processes/review.md": "[broken](missing.md)\n",
    "docs/guide.md": "[broken](missing.md)\n",
    "docs/shared.md": "[rule](../agents/rules/a.md)\n",
}
VALID_SYMLINKS = {**INDEX_LINKS, "agents/shared.md": "../docs/shared.md"}
VALID_OUTPUT = "Checked 37 relative links in 6 Markdown files.\n"


def broken(where, dest):
    return f"{where}: {dest} does not resolve to a file or directory in the repository"


def unresolved(path):
    return f"{path}: does not resolve to a file in the repository"


def unreadable(where):
    return f"{where}: a link the check cannot read"


# name: (files, symlinks, files deleted after staging, errors)
FAILURES = {
    "missing file": (
        {"agents/AGENTS.md": "# Index\n\n[rule](rules/none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:3", "rules/none.md")],
    ),
    "wrapped link text": (
        {"agents/AGENTS.md": "[wrapped\ntext](none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:2", "none.md")],
    ),
    "reference definition": (
        {"agents/AGENTS.md": "[label]: rules/none.md\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "rules/none.md")],
    ),
    "wrapped reference definition": (
        {"agents/AGENTS.md": "[label]:\n  rules/none.md\n"},
        {},
        [],
        [broken("agents/AGENTS.md:2", "rules/none.md")],
    ),
    "root-relative link": (
        {"agents/AGENTS.md": "[rule](/agents/none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "/agents/none.md")],
    ),
    "parentheses in the destination": (
        {"agents/AGENTS.md": "[rule](rules/none(1).md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "rules/none(1).md")],
    ),
    "parenthesized title": (
        {"agents/AGENTS.md": "[rule](rules/none.md (Rule))\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "rules/none.md")],
    ),
    "image inside link text": (
        {"agents/AGENTS.md": "[![logo](none.png)](rules/a.md)\n", "agents/rules/a.md": ""},
        {},
        [],
        [broken("agents/AGENTS.md:1", "none.png")],
    ),
    "escaped backslash before a bracket": (
        {"agents/AGENTS.md": "An escaped backslash: \\\\[rule](none.md).\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "none.md")],
    ),
    "fence opened after a list marker": (
        {"agents/AGENTS.md": "- ~~~md\n  code\n  ~~~\n\n[rule](none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:5", "none.md")],
    ),
    "fence closed in a block quote": (
        {"agents/AGENTS.md": "> ```\n> [code](none.md)\n> ```\n\n[rule](none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:5", "none.md")],
    ),
    "link syntax the check cannot read": (
        {
            "agents/AGENTS.md": "[deep [nest [ing]]](rules/a.md)\n[x](rules/a((1)).md)\n",
            "agents/rules/a.md": "",
        },
        {},
        [],
        [unreadable("agents/AGENTS.md:1"), unreadable("agents/AGENTS.md:2")],
    ),
    "fence closed only at its block-quote depth": (
        {"agents/AGENTS.md": "```md\n> ```\n[code](none.md)\n```\n\n[rule](none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:6", "none.md")],
    ),
    "reference in a block quote": (
        {"agents/AGENTS.md": "> [Read][rule]\n>\n> [rule]: rules/none.md\n"},
        {},
        [],
        [broken("agents/AGENTS.md:3", "rules/none.md")],
    ),
    "reference in a list item": (
        {"agents/AGENTS.md": "- [rule]: rules/none.md\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "rules/none.md")],
    ),
    "fence ended by its list item": (
        {"agents/AGENTS.md": "- ~~~\n  code\n\n[rule](rules/none.md)\n\n~~~sh\ncode\n~~~\n"},
        {},
        [],
        [broken("agents/AGENTS.md:4", "rules/none.md")],
    ),
    "fence ended by its block quote": (
        {"agents/AGENTS.md": "> ```\n> code\n\n[rule](rules/none.md)\n\n```sh\ncode\n```\n"},
        {},
        [],
        [broken("agents/AGENTS.md:4", "rules/none.md")],
    ),
    "reference in a nested list item": (
        {"agents/AGENTS.md": "- a\n  - b\n\n    [rule]: rules/none.md\n"},
        {},
        [],
        [broken("agents/AGENTS.md:4", "rules/none.md")],
    ),
    "angle-bracket reference definition": (
        {"agents/AGENTS.md": "[label]: <rules/x none.md>\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "<rules/x none.md>")],
    ),
    "closing fence indented four columns": (
        {
            "agents/AGENTS.md": (
                "```md\n- item\n\n    ```sh\n    code\n    ```\n```\n\n"
                "[rule](rules/none.md)\n\n```sh\nx\n```\n"
            )
        },
        {},
        [],
        [broken("agents/AGENTS.md:9", "rules/none.md")],
    ),
    "opening fence indented four columns": (
        {"agents/AGENTS.md": "Text\n\n    ```\n[rule](rules/none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:4", "rules/none.md")],
    ),
    "unknown link scheme": (
        {"agents/AGENTS.md": "[severity](severity.md:5)\n"},
        {},
        [],
        ["agents/AGENTS.md:1: severity.md:5 is not a web, mail, or relative link"],
    ),
    "link in inline code": (
        {"agents/AGENTS.md": "Use `[example](none.md)` here.\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "none.md")],
    ),
    "reference title with a backtick": (
        {
            "agents/AGENTS.md": (
                '[first]: rules/a.md "The ` mark"\n[second]: rules/none.md "Use `"\n'
            ),
            "agents/rules/a.md": "",
        },
        {},
        [],
        [broken("agents/AGENTS.md:2", "rules/none.md")],
    ),
    "link after a setext heading": (
        {"agents/AGENTS.md": "Heading `open\n--\n[rule](rules/none.md) close`\n"},
        {},
        [],
        [broken("agents/AGENTS.md:3", "rules/none.md")],
    ),
    "link in a table cell": (
        {
            "agents/AGENTS.md": (
                "| Command | Rule |\n| --- | --- |\n| `first | [rule](rules/none.md) |\n"
                "| second` | text |\n"
            )
        },
        {},
        [],
        [broken("agents/AGENTS.md:3", "rules/none.md")],
    ),
    "fence ended by a block quote inside a list item": (
        {"agents/AGENTS.md": "- > ```\n  > code\n  [rule](rules/none.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:3", "rules/none.md")],
    ),
    "fence in a list item after a lazy line": (
        {"agents/AGENTS.md": "- item\nlazy\n  ```\n[rule](rules/none.md)\n```\n"},
        {},
        [],
        [
            broken("agents/AGENTS.md:4", "rules/none.md"),
            "agents/AGENTS.md:5: a code fence that never closes",
        ],
    ),
    "block quote marker indented four columns": (
        {"agents/AGENTS.md": "    > ```\n[x](rules/none.md)\n    > ```\n    > [y](rules/none.md)"},
        {},
        [],
        [
            broken("agents/AGENTS.md:2", "rules/none.md"),
            broken("agents/AGENTS.md:4", "rules/none.md"),
        ],
    ),
    "list marker indented four columns": (
        {"agents/AGENTS.md": "    - ```\n[rule](rules/none.md)\n    - ```\n"},
        {},
        [],
        [broken("agents/AGENTS.md:2", "rules/none.md")],
    ),
    "fence that never closes": (
        {"agents/AGENTS.md": "# Index\n\n```sh\n[code](none.md)\n"},
        {},
        [],
        ["agents/AGENTS.md:3: a code fence that never closes"],
    ),
    "outside the repository": (
        {"agents/AGENTS.md": "[up](../../outside.md)\n"},
        {},
        [],
        [broken("agents/AGENTS.md:1", "../../outside.md")],
    ),
    "ignored file": (
        {
            ".gitignore": "/agents/.processes/\n",
            "agents/.processes/review.md": "",
            "agents/AGENTS.md": "[review](.processes/review.md)\n",
        },
        {},
        [],
        [broken("agents/AGENTS.md:1", ".processes/review.md")],
    ),
    "wrong case": (
        {"agents/AGENTS.md": "[rule](rules/a.md)\n", "agents/rules/A.md": ""},
        {},
        [],
        [broken("agents/AGENTS.md:1", "rules/a.md")],
    ),
    "tracked file deleted": (
        {"agents/AGENTS.md": "[rule](rules/a.md)\n", "agents/rules/a.md": ""},
        {},
        ["agents/rules/a.md"],
        [broken("agents/AGENTS.md:1", "rules/a.md")],
    ),
    "symlink to a missing file": (
        {"agents/AGENTS.md": "![logo](logo.svg)\n"},
        {"agents/logo.svg": "missing.svg"},
        [],
        [broken("agents/AGENTS.md:1", "logo.svg")],
    ),
    "symlink to an ignored file": (
        {
            ".gitignore": "/agents/.processes/\n",
            "agents/.processes/logo.svg": "",
            "agents/AGENTS.md": "![logo](logo.svg)\n",
        },
        {"agents/logo.svg": ".processes/logo.svg"},
        [],
        [broken("agents/AGENTS.md:1", "logo.svg")],
    ),
    "symlink cycles": (
        {"agents/AGENTS.md": "![self](self.svg)\n![pair](a.svg)\n"},
        {"agents/self.svg": "self.svg", "agents/a.svg": "b.svg", "agents/b.svg": "a.svg"},
        [],
        [broken("agents/AGENTS.md:1", "self.svg"), broken("agents/AGENTS.md:2", "a.svg")],
    ),
    "link through a symlinked directory": (
        {"agents/AGENTS.md": "[guide](shared/guide.md)\n", "docs/guide.md": ""},
        {"agents/shared": "../docs"},
        [],
        [broken("agents/AGENTS.md:1", "shared/guide.md")],
    ),
    "page symlink cycle": (
        {"LICENSE": ""},
        {"agents/loop.md": "loop.md"},
        [],
        [unresolved("agents/loop.md")],
    ),
    "page symlink to a missing file": (
        {"LICENSE": ""},
        {"agents/old.md": "missing.md"},
        [],
        [unresolved("agents/old.md")],
    ),
    "page read through its symlink": (
        {"docs/shared.md": "[rule](none.md)\n"},
        {"agents/shared.md": "../docs/shared.md"},
        [],
        [broken("docs/shared.md:1", "none.md")],
    ),
    "root page": (
        {"README.md": "[docs](docs.md)\n"},
        {},
        [],
        [broken("README.md:1", "docs.md")],
    ),
    "index name as a regular file": (
        {"AGENTS.md": "# Index\n", "agents/AGENTS.md": "# Index\n"},
        {"CLAUDE.md": "agents/AGENTS.md"},
        [],
        ["AGENTS.md: must be a symlink to agents/AGENTS.md"],
    ),
    "directory at an index name": (
        {"CLAUDE.md/notes.txt": "", "agents/AGENTS.md": "# Index\n"},
        {"AGENTS.md": "agents/AGENTS.md"},
        [],
        ["CLAUDE.md: must be a symlink to agents/AGENTS.md"],
    ),
    "index link to another page": (
        {"README.md": "", "agents/AGENTS.md": "# Index\n"},
        {"AGENTS.md": "agents/AGENTS.md", "CLAUDE.md": "README.md"},
        [],
        ["CLAUDE.md: must be a symlink to agents/AGENTS.md"],
    ),
    "index link without the index": (
        {"LICENSE": ""},
        {"AGENTS.md": "agents/AGENTS.md"},
        [],
        ["AGENTS.md: must be a symlink to agents/AGENTS.md", unresolved("AGENTS.md")],
    ),
    "every failure listed, in file order": (
        {
            "README.md": "[a](a.md)\n",
            "agents/AGENTS.md": "[r]: r.md\n\n[b](b.md)\n\n[c](c.md)\n",
        },
        {"AGENTS.md": "agents/AGENTS.md", "CLAUDE.md": "README.md"},
        [],
        [
            "CLAUDE.md: must be a symlink to agents/AGENTS.md",
            broken("README.md:1", "a.md"),
            broken("agents/AGENTS.md:1", "r.md"),
            broken("agents/AGENTS.md:3", "b.md"),
            broken("agents/AGENTS.md:5", "c.md"),
        ],
    ),
}


def run_check(files, symlinks, deleted=(), stage=True, cwd="."):
    """Build a repository, stage it as CI's checkout tracks it unless told not to, and check it."""
    with tempfile.TemporaryDirectory() as root:
        git = ["git", "-C", root]
        subprocess.run([*git, "init", "-q"], check=True, capture_output=True, env=ENV)
        for path, text in files.items():
            os.makedirs(os.path.join(root, os.path.dirname(path)), exist_ok=True)
            with open(os.path.join(root, path), "w", encoding="utf-8") as page:
                page.write(text)
        for path, target in symlinks.items():
            os.makedirs(os.path.join(root, os.path.dirname(path)), exist_ok=True)
            os.symlink(target, os.path.join(root, path))
        if stage:
            subprocess.run([*git, "add", "-A"], check=True, capture_output=True, env=ENV)
        for path in deleted:
            os.remove(os.path.join(root, path))
        return subprocess.run(
            [sys.executable, SCRIPT],
            cwd=os.path.join(root, cwd),
            env=ENV,
            capture_output=True,
            text=True,
        )


class CheckDocsTest(unittest.TestCase):
    def test_passes_without_agent_docs(self):
        result = run_check({"LICENSE": ""}, {})
        self.assertEqual(
            (result.returncode, result.stdout, result.stderr),
            (0, "Checked 0 relative links in 0 Markdown files.\n", ""),
        )

    def test_a_heading_ends_a_list_and_its_lazy_lines(self):
        page = "- item\n# Heading\n  ```\n[rule](rules/none.md)\n  ```\n"
        result = run_check({"agents/AGENTS.md": page}, {})
        self.assertEqual(
            (result.returncode, result.stdout, result.stderr),
            (0, "Checked 0 relative links in 1 Markdown files.\n", ""),
        )

    def test_checks_every_relative_link_outside_code(self):
        result = run_check(VALID, VALID_SYMLINKS)
        self.assertEqual(
            (result.returncode, result.stdout, result.stderr), (0, VALID_OUTPUT, "")
        )

    def test_reads_untracked_files_that_are_not_ignored(self):
        result = run_check(VALID, VALID_SYMLINKS, stage=False)
        self.assertEqual(
            (result.returncode, result.stdout, result.stderr), (0, VALID_OUTPUT, "")
        )

    def test_runs_from_a_subdirectory(self):
        result = run_check(VALID, VALID_SYMLINKS, cwd="agents/rules")
        self.assertEqual(
            (result.returncode, result.stdout, result.stderr), (0, VALID_OUTPUT, "")
        )

    def test_lists_every_failure(self):
        for name, (files, symlinks, deleted, errors) in FAILURES.items():
            with self.subTest(name):
                result = run_check(files, symlinks, deleted)
                self.assertEqual(
                    (result.returncode, result.stdout, result.stderr),
                    (1, "", "".join(f"{error}\n" for error in errors)),
                )


if __name__ == "__main__":
    unittest.main()
