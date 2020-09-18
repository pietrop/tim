/* eslint no-unused-expressions: 0 */
import Prism from 'prismjs';
import React, { useCallback, useMemo } from 'react';
import { atom, useRecoilState, useRecoilValue } from 'recoil';
import { connect } from 'react-redux';

import isHotkey from 'is-hotkey';
import { Slate, Editable, withReact } from 'slate-react';
import { Text, createEditor } from 'slate';
import { withHistory } from 'slate-history';

import timecode from 'smpte-timecode';

import { update } from '../reducers/data';
import Leaf from './Leaf';

import './Editor.css';

(Prism.languages.markdown = Prism.languages.extend('markup', {})),
  Prism.languages.insertBefore('markdown', 'prolog', {
    blockquote: { pattern: /^>(?:[\t ]*>)*/m, alias: 'punctuation' },
    code: [
      { pattern: /^(?: {4}|\t).+/m, alias: 'keyword' },
      { pattern: /``.+?``|`[^`\n]+`/, alias: 'keyword' },
    ],
    title: [
      // {
      //   pattern: /\w+.*(?:\r?\n|\r)(?:==+|--+)/,
      //   alias: 'important',
      //   inside: { punctuation: /==+$|--+$/ },
      // },
      {
        pattern: /(^\s*)#+.+/m,
        lookbehind: !0,
        alias: 'important',
        inside: { punctuation: /^#+|#+$/ },
      },
    ],
    hr: {
      pattern: /(^\s*)([*-])([\t ]*\2){2,}(?=\s*$)/m,
      lookbehind: !0,
      alias: 'punctuation',
    },
    list: {
      pattern: /(^\s*)(?:[*+-]|\d+\.)(?=[\t ].)/m,
      lookbehind: !0,
      alias: 'punctuation',
    },
    // 'url-reference': {
    //   pattern: /!?\[[^\]]+\]:[\t ]+(?:\S+|<(?:\\.|[^>\\])+>)(?:[\t ]+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)))?/,
    //   inside: {
    //     variable: { pattern: /^(!?\[)[^\]]+/, lookbehind: !0 },
    //     string: /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))$/,
    //     punctuation: /^[\[\]!:]|[<>]/,
    //   },
    //   alias: 'url',
    // },
    bold: {
      pattern: /(^|[^\\])(\*\*|__)(?:(?:\r?\n|\r)(?!\r?\n|\r)|.)+?\2/,
      lookbehind: !0,
      inside: { punctuation: /^\*\*|^__|\*\*$|__$/ },
    },
    italic: {
      pattern: /(^|[^\\])([*_])(?:(?:\r?\n|\r)(?!\r?\n|\r)|.)+?\2/,
      lookbehind: !0,
      inside: { punctuation: /^[*_]|[*_]$/ },
    },
    timecode: {
      pattern: /\[(?:[01]\d|2[0123]):(?:[012345]\d):(?:[012345]\d)\](?=\s*\w)/,
      lookbehind: !0,
      // inside: { punctuation: /^[*_]|[*_]$/ },
      // alias: "timecode"
    },
    timecodeL: {
      pattern: /(?<!^)\[(?:[01]\d|2[0123]):(?:[012345]\d):(?:[012345]\d)\](?=$)/,
      lookbehind: !0,
      // inside: { punctuation: /^[*_]|[*_]$/ },
      // alias: "timecode"
    },
    timecode3: {
      pattern: /^\[(?:[01]\d|2[0123]):(?:[012345]\d):(?:[012345]\d)\](?=\s*$)/,
      lookbehind: !0,
      // inside: { punctuation: /^[*_]|[*_]$/ },
      // alias: "timecode"
    },
    timecode2: {
      pattern: /(?:[01]\d|2[0123]):(?:[012345]\d):(?:[012345]\d)/,
      lookbehind: !0,
      // inside: { punctuation: /^[*_]|[*_]$/ },
    },
    url: {
      pattern: /!?\[[^\]]+\](?:\([^\s)]+(?:[\t ]+"(?:\\.|[^"\\])*")?\)| ?\[[^\]\n]*\])/,
      inside: {
        variable: { pattern: /(!?\[)[^\]]+(?=\]$)/, lookbehind: !0 },
        string: { pattern: /"(?:\\.|[^"\\])*"(?=\)$)/ },
      },
    },
  }),
  (Prism.languages.markdown.bold.inside.url = Prism.util.clone(Prism.languages.markdown.url)),
  (Prism.languages.markdown.italic.inside.url = Prism.util.clone(Prism.languages.markdown.url)),
  (Prism.languages.markdown.bold.inside.italic = Prism.util.clone(Prism.languages.markdown.italic)),
  (Prism.languages.markdown.italic.inside.bold = Prism.util.clone(Prism.languages.markdown.bold));

const HOTKEYS = {
  'mod+j': 'time',
  'ctrl+j': 'time',
  'shift+mod+j': 'times',
  'shift+ctrl+j': 'times',
};

const progressState = atom({
  key: 'progressState',
  default: 0,
});

const Editor = ({ data, update, player }) => {
  const progress = useRecoilValue(progressState);
  const renderLeaf = useCallback(props => <Leaf {...props} />, []);
  const editor = useMemo(() => withHistory(withReact(createEditor())), []);

  const seekTo = useCallback(time => player.current?.seekTo(time, 'seconds'), [player]);
  const handleClick = useCallback(
    event => {
      const target = event.nativeEvent.srcElement;
      if (target.nodeName === 'SPAN') {
        const text = target.innerText.replace(/\[|\]/g, '').trim();
        let tc = null;

        try {
          tc = timecode(`${text}:00`, 1e3);
        } catch (ignored) {}

        tc && seekTo(tc.frameCount / 1e3);
      }
    },
    [seekTo]
  );

  const decorate = useCallback(([node, path]) => {
    const ranges = [];

    if (!Text.isText(node)) {
      return ranges;
    }

    const getLength = token => {
      if (typeof token === 'string') {
        return token.length;
      } else if (typeof token.content === 'string') {
        return token.content.length;
      } else {
        return token.content.reduce((l, t) => l + getLength(t), 0);
      }
    };

    const tokens = Prism.tokenize(node.text, Prism.languages.markdown);
    let start = 0;

    for (const token of tokens) {
      const length = getLength(token);
      const end = start + length;

      if (typeof token !== 'string') {
        ranges.push({
          [token.type]: true,
          anchor: { path, offset: start },
          focus: { path, offset: end },
        });
      }

      start = end;
    }

    return ranges;
  }, []);

  return (
    <div onClick={handleClick}>
      <Slate editor={editor} value={data.editor} onChange={value => update({ editor: value })}>
        <Editable
          decorate={decorate}
          renderLeaf={renderLeaf}
          placeholder="Write some markdown…"
          autoFocus
          onKeyDown={event => {
            for (const hotkey in HOTKEYS) {
              if (isHotkey(hotkey, event)) {
                event.preventDefault();

                const mark = HOTKEYS[hotkey];

                if (mark.startsWith('time')) {
                  const tokens = [];

                  mark === 'times' &&
                    [3, 2, 1]
                      .filter(delta => progress >= delta)
                      .forEach(delta => {
                        const tc = timecode((progress - delta) * 1e3, 1e3);
                        const [hh, mm, ss, mmm] = tc.toString().split(':');
                        tokens.push(`[${hh}:${mm}:${ss}]`);
                      });

                  const tc = timecode(progress * 1e3, 1e3);
                  const [hh, mm, ss, mmm] = tc.toString().split(':');
                  tokens.push(`[${hh}:${mm}:${ss}]`);

                  editor.insertText(tokens.join(' '));
                }
              }
            }
          }}
        />
      </Slate>
    </div>
  );
};

export default connect(({ data }) => ({ data }), { update })(Editor);
