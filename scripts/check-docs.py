#!/usr/bin/env python3
"""Check the agent docs.

Every relative Markdown link under agents/ and in the root *.md files must resolve to a file or
directory in the repository, and the root AGENTS.md and CLAUDE.md, when present, must be symlinks
to agents/AGENTS.md. A path is in the repository when git tracks it or would add it (untracked and
not ignored), so an ignored local file, which CI's checkout lacks, never counts. A symlink counts
only when the path it leads to exists and is in the repository too, and a symlinked page is read
at that path; a link through a symlinked directory fails, since git lists the symlink and not the
files it leads to. A link starting with `/` resolves from the repository root, as GitHub renders
it. Anchors are not checked.

Only fenced code blocks are skipped, found as Markdown finds them, inside block quotes and list
items. Everything else reads as prose, inline code and indented code included, so an example link
belongs in a fenced block. HTML links are not checked. Markdown the check cannot read fails it
rather than being skipped: a `](` outside every link it recognizes, a link with a scheme other
than http, https, or mailto, and a code fence that never closes.

Run from anywhere in the repository. Prints a summary and exits 0, or lists every failure on
stderr and exits 1.
"""

import os
import re
import string
import subprocess
import sys
from urllib.parse import unquote, urlsplit

INDEX = "agents/AGENTS.md"
INDEX_LINKS = ("AGENTS.md", "CLAUDE.md")
TARGET = "file or directory in the repository"
# Links that leave the repository; any other scheme fails the check.
SCHEMES = ("http", "https", "mailto")

# Block structure, matched on a line once its tabs are expanded. Each opens with at most three
# spaces of indentation; a backtick fence's info string holds no backtick.
QUOTE_MARKER = re.compile(r" {0,3}>[ \t]?")
LIST_ITEM = re.compile(r" {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)")
BREAK = re.compile(r" {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$")
HEADING = re.compile(r" {0,3}#{1,6}(?:[ \t]|$)")
FENCE = re.compile(r" {0,3}(`{3,}(?!.*`)|~{3,})")
# Markdown lets a backslash escape any ASCII punctuation.
PUNCTUATION = frozenset(string.punctuation)
ESCAPE = re.compile(rf"\\([{re.escape(string.punctuation)}])")
# Markdown's link syntax, with backslash escapes and one level of nested brackets or parentheses.
TEXT = r"\[(?:[^\[\]\\]|\\.|\[(?:[^\[\]\\]|\\.)*\])*\]"
DEST = r"<(?:[^<>\n\\]|\\.)*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+"
TITLE = r"\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)"
# `[text](dest "title")`, also inside `![alt](dest)`.
INLINE_LINK = re.compile(rf"{TEXT}\(\s*({DEST})(?:\s+(?:{TITLE}))?\s*\)", re.DOTALL)
# `[label]: dest`, the destination on the same line or the next, but not a `[^note]:` footnote.
REFERENCE = re.compile(
    r"^[ \t]*\[(?!\^)(?:[^\[\]\\]|\\.)+\]:[ \t]*\n?[ \t]*(<(?:[^<>\n\\]|\\.)*>|\S+)", re.MULTILINE
)


def git(*args):
    return subprocess.check_output(["git", *args], text=True)


def real(path):
    """Return the repository-relative path that path's symlinks lead to."""
    return os.path.relpath(os.path.realpath(path))


def repo_paths():
    """Return the repository's files, and those files with every directory that holds one."""
    listed = git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0")
    files = {path for path in listed if path and os.path.lexists(path)}
    paths = files | {"."}
    for path in files:
        parent = os.path.dirname(path)
        while parent and parent not in paths:
            paths.add(parent)
            parent = os.path.dirname(parent)
    return files, paths


def index_link_errors(files, paths):
    """Return an error for each root index name present but not a symlink to INDEX."""
    index_exists = INDEX in files and os.path.isfile(INDEX)
    return [
        f"{name}: must be a symlink to {INDEX}"
        for name in INDEX_LINKS
        if name in paths
        and not (index_exists and os.path.islink(name) and real(name) == real(INDEX))
    ]


def indent(text):
    return len(text) - len(text.lstrip(" "))


def enter(containers, line):
    """Match a line against the open containers, outermost first.

    A block quote continues on a line with its marker, and a list item on a blank line or one
    indented to its content column. Returns how many matched and the rest of the line.
    """
    for count, container in enumerate(containers):
        if container == ">":
            if not (marker := QUOTE_MARKER.match(line)):
                return count, line
            line = line[marker.end() :]
        elif line.strip() and indent(line) < container:
            return count, line
        else:
            line = line[min(container, indent(line)) :]
    return len(containers), line


def prose(text):
    """Return the page with fenced code blanked and container markers removed, line for line, and
    the line of a fence that never closes, or None.

    A fence closes on a closing fence inside its containers, or where one of them ends.
    """
    kept, containers, fence, paragraph = [], [], None, False
    for number, line in enumerate(text.expandtabs(4).split("\n"), 1):
        matched, rest = enter(containers, line)
        if fence:
            marker, depth, _ = fence
            if matched >= depth:
                closing = rest.strip()
                if indent(rest) <= 3 and len(closing) >= len(marker):
                    if closing == marker[0] * len(closing):
                        fence = None
                kept.append("")
                continue
            fence = None  # one of its containers ended
        blocks = (QUOTE_MARKER, LIST_ITEM, FENCE, BREAK, HEADING)
        starts = any(block.match(rest) for block in blocks)
        if paragraph and matched < len(containers) and rest.strip() and not starts:
            kept.append(rest)  # a lazy line continues the open paragraph and its containers
            continue
        del containers[matched:]
        while True:
            if marker := QUOTE_MARKER.match(rest):
                containers.append(">")
            elif not BREAK.match(rest) and (marker := LIST_ITEM.match(rest)):
                containers.append(marker.end())
            else:
                break
            rest = rest[marker.end() :]
        if match := FENCE.match(rest):
            fence = (match.group(1), len(containers), number)
            rest = ""
        paragraph = bool(rest.strip()) and not BREAK.match(rest)
        kept.append(rest)
    return "\n".join(kept), fence[2] if fence else None


def brackets(text):
    """Return the offsets of each unescaped `[` and each unescaped `](`."""
    opens, closes, i = [], [], 0
    while i < len(text):
        char = text[i]
        if char == "\\" and text[i + 1 : i + 2] in PUNCTUATION:
            i += 1
        elif char == "[":
            opens.append(i)
        elif char == "]" and text[i + 1 : i + 2] == "(":
            closes.append(i)
        i += 1
    return opens, closes


def parse(text):
    """Return a page's links and problems as (line, destination, problem), in file order."""
    page, unclosed = prose(text)
    opens, closes = brackets(page)
    inline = [match for match in (INLINE_LINK.match(page, start) for start in opens) if match]

    def line(offset):
        return page.count("\n", 0, offset) + 1

    found = []
    for match in [*inline, *REFERENCE.finditer(page)]:
        dest = match.group(1)
        if url(dest).scheme in ("", *SCHEMES):
            found.append((line(match.start(1)), dest, None))
        else:
            problem = f"{dest} is not a web, mail, or relative link"
            found.append((line(match.start(1)), None, problem))
    found += [
        (line(close), None, "a link the check cannot read")
        for close in closes
        if not any(match.start() <= close < match.end() for match in inline)
    ]
    if unclosed:
        found.append((unclosed, None, "a code fence that never closes"))
    return sorted(found, key=lambda item: item[0])


def url(dest):
    """Split a link destination, without its angle brackets and backslash escapes, into a URL."""
    return urlsplit(ESCAPE.sub(r"\1", dest[1:-1] if dest.startswith("<") else dest))


def resolve(source, dest):
    """Return the repository path a relative link points to, or None for a web or mail link."""
    parts = url(dest)
    if parts.scheme or parts.netloc or not parts.path:
        return None
    path = unquote(parts.path)
    base = "" if path.startswith("/") else os.path.dirname(source)
    return os.path.normpath(os.path.join(base, path.lstrip("/")))


def main():
    os.chdir(git("rev-parse", "--show-toplevel").strip())
    files, paths = repo_paths()
    errors = index_link_errors(files, paths)
    pages = set()
    for path in sorted(files):
        if path.endswith(".md") and (path.startswith("agents/") or "/" not in path):
            if real(path) in files and os.path.isfile(path):
                pages.add(real(path))
            else:
                errors.append(f"{path}: does not resolve to a file in the repository")
    checked = 0
    for page in sorted(pages):
        with open(page, encoding="utf-8") as markdown:
            text = markdown.read()
        for line, dest, problem in parse(text):
            if problem:
                errors.append(f"{page}:{line}: {problem}")
                continue
            target = resolve(page, dest)
            if target is None:
                continue
            checked += 1
            if not (target in paths and real(target) in paths and os.path.exists(target)):
                errors.append(f"{page}:{line}: {dest} does not resolve to a {TARGET}")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Checked {checked} relative links in {len(pages)} Markdown files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
