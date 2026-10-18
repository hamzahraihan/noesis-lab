/**
 * Monaco, wired to Arduino and to the subset of Arduino this bench implements.
 *
 * The completion list is not the full Arduino API. It is exactly what the
 * firmware interpreter in `sim/firmware` will actually run, which is a much
 * more useful thing to offer: an autocomplete that suggests `analogWrite` is a
 * promise that the call works, and one that omits `attachInterrupt` is a
 * warning that it does not. A sketch that compiles here still has to make
 * electrical sense on the bench, and this is the first place that shows.
 *
 * Monaco itself is loaded from the bundle rather than a CDN so the editor works
 * with no network, which matters because the bench is otherwise entirely local.
 */

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { loader } from '@monaco-editor/react';

/**
 * Monaco runs its language services in web workers. Vite needs to be told it may
 * spawn them; without this the editor loads and then every worker request 404s.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === 'typescript' || label === 'javascript'
      ? new tsWorker()
      : new editorWorker();
  },
};

loader.config({ monaco });

/** Arduino sketch files have no extension in the wild, so name the language. */
export const FIRMWARE_LANGUAGE = 'arduino-cpp';

/**
 * The Python the Pi runs.
 *
 * Monaco ships a Python tokenizer of its own, but it is aimed at CPython's
 * grammar -- `import`, `def`, classes, decorators -- most of which this VM
 * refuses. A name that highlights is a name that looks supported, so the
 * language is registered here against what actually runs: gpiozero's
 * constructors, and the handful of builtins the interpreter answers.
 */
export const PYTHON_LANGUAGE = 'gpiozero-python';

const PYTHON_KEYWORDS = [
  'and', 'as', 'break', 'class', 'continue', 'def', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'if', 'import', 'in', 'is', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield',
  'True', 'False', 'None',
];

const PYTHON_BUILTINS: ReadonlyArray<[name: string, detail: string, doc: string]> = [
  ['LED', 'LED(pin)', 'A gpiozero LED on a board pin.'],
  ['Button', 'Button(pin)', 'A gpiozero button. Reads a press on a pin pulled up.'],
  ['OutputDevice', 'OutputDevice(pin)', 'A plain gpiozero output.'],
  ['InputDevice', 'InputDevice(pin)', 'A plain gpiozero input.'],
  ['PWMOutputDevice', 'PWMOutputDevice(pin)', 'An output you can set to a fraction with .value.'],
  ['print', 'print(value)', 'Writes to the serial monitor.'],
  ['len', 'len(items)', 'How many items something holds.'],
  ['range', 'range(stop)', 'The iterable a for loop walks: range(start, stop, step).'],
  ['abs', 'abs(value)', 'Magnitude of a number.'],
  ['min', 'min(a, b)', 'The smaller of two numbers.'],
  ['max', 'max(a, b)', 'The larger of two numbers.'],
  ['round', 'round(value)', 'Nearest whole number.'],
  ['int', 'int(value)', 'Truncates to a whole number.'],
  ['float', 'float(value)', 'Reads a value as a number.'],
];

function registerPythonLanguage(): void {
  if (monaco.languages.getLanguages().some((language) => language.id === PYTHON_LANGUAGE)) {
    return;
  }

  monaco.languages.register({
    id: PYTHON_LANGUAGE,
    extensions: ['.py'],
    aliases: ['Python', 'gpiozero'],
  });
  monaco.languages.setLanguageConfiguration(PYTHON_LANGUAGE, {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    indentationRules: {
      increaseIndentPattern: /^.*(:|\b(else|elif|except|finally)\b)\s*$/,
      decreaseIndentPattern: /^\s*(return|pass|break|continue)\b.*$/,
    },
  });

  monaco.languages.setMonarchTokensProvider(PYTHON_LANGUAGE, {
    keywords: PYTHON_KEYWORDS,
    tokenizer: {
      root: [
        [/\b(?:LED|Button|OutputDevice|InputDevice|PWMOutputDevice)\b/, 'type'],
        [/\b\d+\.\d*(?:[eE][+-]?\d+)?\b|\b\.\d+\b/, 'number.float'],
        [/0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+/, 'number.hex'],
        [/\d[\d_]*/, 'number'],
        [/[fFrRbB]?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/, 'string'],
        [/#.*$/, 'comment'],
        [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/[+\-*/%&|^~<>=!]=?/, 'operator'],
        [/[{}()[\]]/, '@brackets'],
      ],
    },
  });

  void monaco.languages.registerCompletionItemProvider(PYTHON_LANGUAGE, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: PYTHON_BUILTINS.map(([label, detail, doc]) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${label}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: doc,
          detail,
          range,
        })),
      };
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider(PYTHON_LANGUAGE, {
    provideDocumentFormattingEdits(model) {
      /*
       * Re-indenting a Python file by counting colons is how the whole language
       * is nested, so a formatter that only looks at braces would flatten a
       * file on save. Blank lines and comment lines carry no structure and are
       * left exactly as written.
       */
      const lines = model.getLinesContent();
      const edits: monaco.languages.TextEdit[] = [];
      let indent = 0;
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const opensSuite = trimmed.length > 0 && trimmed.endsWith(':');
        const closesSuite = /^\s*(return|pass|break|raise)\b/.test(trimmed);
        if (closesSuite) indent = Math.max(0, indent - 1);
        const wanted = '\t'.repeat(indent) + trimmed;
        if (wanted !== line) {
          edits.push({
            range: new monaco.Range(index + 1, 1, index + 1, line.length + 1),
            text: wanted,
          });
        }
        if (opensSuite) indent += 1;
      });
      return edits;
    },
  });
}

const ARDUINO_CONSTANTS: ReadonlyArray<[name: string, detail: string, doc: string]> = [
  ['HIGH', '1', 'Logic level for a pin driving the supply rail.'],
  ['LOW', '0', 'Logic level for a pin pulling to ground.'],
  ['INPUT', '0', 'Read the pin. Floating inputs read erratically, which is the point.'],
  ['OUTPUT', '1', 'Drive the pin. Only pins with an output driver can do this.'],
  ['INPUT_PULLUP', '2', 'Read the pin with an internal pull-up. An open button then reads LOW.'],
  ['WL_CONNECTED', '3', 'The join has landed. Poll WiFi.status() until it reads this.'],
  ['WL_IDLE_STATUS', '0', 'A join is in flight. The radio is not connected yet.'],
  ['WL_NO_SSID_AVAIL', '1', 'No network by that name. The SSID is wrong, or out of reach.'],
  ['WL_CONNECT_FAILED', '4', 'The network refused the password.'],
  ['WL_DISCONNECTED', '6', 'Not joined. Nothing was asked for, or the join failed.'],
];

const ARDUINO_FUNCTIONS: ReadonlyArray<[signature: string, doc: string]> = [
  ['pinMode(pin, mode)', 'Set a pin to INPUT, OUTPUT or INPUT_PULLUP.'],
  ['digitalWrite(pin, level)', 'Drive a pin HIGH or LOW.'],
  ['digitalRead(pin)', 'Read a pin as HIGH (1) or LOW (0).'],
  ['analogWrite(pin, value)', 'PWM a pin, 0 to 255. Frequency is set by the board.'],
  ['analogRead(pin)', 'Read a pin as 0 to 1023 on the Uno, 0 to 4095 on the ESP32.'],
  ['delay(ms)', 'Block for milliseconds. Nothing else runs while you wait.'],
  ['delayMicroseconds(us)', 'Block for microseconds, rounded-none to what the simulator can show.'],
  ['millis()', 'Milliseconds since the sketch started.'],
  ['micros()', 'Microseconds since the sketch started.'],
  ['random(max)', 'A random integer below max.'],
  ['constrain(x, low, high)', 'Clamp x into the range.'],
  ['map(x, inLow, inHigh, outLow, outHigh)', 'Rescale x from one range to another.'],
  ['min(a, b, ...)', 'The smallest argument.'],
  ['max(a, b, ...)', 'The largest argument.'],
  ['abs(x)', 'Absolute value.'],
  ['sq(x)', 'x squared.'],
  ['pow(base, exponent)', 'Raise base to a power.'],
];

const ARDUINO_OBJECTS: ReadonlyArray<[name: string, members: ReadonlyArray<[member: string, doc: string]>]> = [
  [
    'Serial',
    [
      ['begin(baud)', 'Open the serial port. The monitor needs the same baud rate.'],
      ['print(value, decimals?)', 'Print without a newline. A second argument rounds.'],
      ['println(value)', 'Print with a newline.'],
    ],
  ],
  [
    'Wire',
    [
      ['begin()', 'Join the I2C bus as a controller.'],
      ['beginTransmission(address)', 'Claim the bus for one transfer.'],
      ['write(value)', 'Send a byte. Also accepts a string.'],
      ['endTransmission()', 'Release the bus and return how long the transfer took.'],
    ],
  ],
  [
    'SPI',
    [
      ['begin()', 'Bring up the SPI controller.'],
      ['transfer(value)', 'Exchange one byte and return the byte shifted back.'],
      ['end()', 'Tear the controller down.'],
    ],
  ],
  [
    'WiFi',
    [
      ['begin(ssid, password)', 'Start joining a network. Poll status() until it reads WL_CONNECTED.'],
      ['status()', 'How the join is going, as a WL_ code. WL_IDLE_STATUS while it is in flight.'],
      ['localIP()', 'The address the network handed out, or nothing while there is none.'],
    ],
  ],
  [
    'net',
    [
      ['get(url)', 'Ask for a url. Answers whether the answer has arrived, so poll it.'],
      ['read()', 'The body of the answer, once get() has said it is here.'],
      ['failed()', 'Whether the answer was a failure: a name or a path the network does not serve.'],
      ['subscribe(topic)', 'Listen for messages on a topic the network publishes.'],
      ['available()', 'Whether a subscribed message is waiting to be read.'],
      ['message()', 'Read the waiting message. It is handed over once.'],
      ['reset()', 'Forget the last request, so a new one starts from nothing.'],
    ],
  ],
];

function registerArduinoLanguage(): void {
  if (monaco.languages.getLanguages().some((language) => language.id === FIRMWARE_LANGUAGE)) {
    return;
  }

  monaco.languages.register({ id: FIRMWARE_LANGUAGE, extensions: ['.ino'], aliases: ['Arduino', 'arduino-cpp'] });
  monaco.languages.setLanguageConfiguration(FIRMWARE_LANGUAGE, {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
    ],
  });

  monaco.languages.setMonarchTokensProvider(FIRMWARE_LANGUAGE, {
    keywords: [
      'void', 'int', 'long', 'float', 'double', 'char', 'bool', 'const', 'static',
      'unsigned', 'signed', 'struct', 'enum', 'return', 'if', 'else', 'while', 'do',
      'for', 'switch', 'case', 'default', 'break', 'continue', 'true', 'false',
    ],
    types: ['void', 'int', 'long', 'float', 'double', 'char', 'bool', 'String'],
    builtins: [
      ...ARDUINO_FUNCTIONS.map(([signature]) => signature.slice(0, signature.indexOf('('))),
      'setup', 'loop',
    ],
    constants: ARDUINO_CONSTANTS.map(([name]) => name),
    tokenizer: {
      root: [
        [/^\s*#\s*\w+/, 'keyword.directive'],
        [/#\s*include\s*[<"]/, 'keyword.directive', '@include'],
        [/#\s*define/, 'keyword.directive'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@types': 'type',
            '@constants': 'constant',
            '@builtins': 'keyword.flow',
            '@default': 'identifier',
          },
        }],
        [/\d*\.\d+([eE][-+]?\d+)?[fF]?/, 'number.float'],
        [/\d+[uUlL]*/, 'number'],
        [/[{}()[\]]/, '@brackets'],
        [/[<>=!+\-*/%&|^~?:]+/, 'operator'],
        [/[;,.]/, 'delimiter'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/'/, 'string', '@char'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
      char: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop'],
      ],
      include: [
        [/[<"]/, { token: 'string', next: '@includeString' }],
      ],
      includeString: [
        [/[^>"]+/, 'string'],
        [/[>"]/, { token: 'string', next: '@pop' }],
      ],
    },
  });

  const completionProvider = monaco.languages.registerCompletionItemProvider(FIRMWARE_LANGUAGE, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions: monaco.languages.CompletionItem[] = [
        ...ARDUINO_FUNCTIONS.map(([signature, doc]) => {
          const name = signature.slice(0, signature.indexOf('('));
          return {
            label: name,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: `${name}($0)`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: doc,
            detail: signature,
            range,
          };
        }),
        ...ARDUINO_CONSTANTS.map(([name, detail, doc]) => ({
          label: name,
          kind: monaco.languages.CompletionItemKind.Constant,
          insertText: name,
          documentation: doc,
          detail,
          range,
        })),
        ...ARDUINO_OBJECTS.flatMap(([object, members]) =>
          members.map(([member, doc]) => ({
            label: `${object}.${member}`,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: `${object}.${member}`,
            documentation: doc,
            range,
          })),
        ),
        {
          label: 'setup',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'void setup() {\n\t$0\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Runs once when the board resets.',
          range,
        },
        {
          label: 'loop',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'void loop() {\n\t$0\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'Runs over and over. A loop with no delay in it still simulates.',
          range,
        },
      ];
      return { suggestions };
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider(FIRMWARE_LANGUAGE, {
    provideDocumentFormattingEdits(model) {
      const lines = model.getLinesContent();
      const edits: monaco.languages.TextEdit[] = [];
      let indent = 0;
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        const closes = trimmed.startsWith('}');
        const level = Math.max(0, indent - (closes ? 1 : 0));
        const wanted = '\t'.repeat(level) + trimmed;
        if (wanted !== line) {
          edits.push({
            range: new monaco.Range(index + 1, 1, index + 1, line.length + 1),
            text: wanted,
          });
        }
        const opened = (trimmed.match(/\{/g) ?? []).length;
        const closedCount = (trimmed.match(/\}/g) ?? []).length;
        indent += opened - closedCount;
        if (indent < 0) indent = 0;
      });
      return edits;
    },
  });

  // The provider is registered for the language's whole lifetime; Monaco has no
  // teardown for this, which is why the guard above stops a re-register.
  void completionProvider;
}

registerArduinoLanguage();

registerPythonLanguage();

/** Editor theme, so the code pane matches the rest of the bench. */
export const FIRMWARE_THEME = 'noesis-dark';

monaco.editor.defineTheme(FIRMWARE_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c084fc' },
    { token: 'keyword.flow', foreground: '38bdf8' },
    { token: 'keyword.directive', foreground: 'f59e0b' },
    { token: 'type', foreground: '5eead4' },
    { token: 'constant', foreground: 'fbbf24' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: 'fb923c' },
    { token: 'identifier', foreground: 'e2e8f0' },
  ],
  colors: {
    'editor.background': '#0f172a',
    'editorGutter.background': '#0f172a',
    'editorLineNumber.foreground': '#475569',
    'editorLineNumber.activeForeground': '#94a3b8',
  },
});

export { monaco };
