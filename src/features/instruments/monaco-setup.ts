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
import { FIRMWARE_LANGUAGE, FIRMWARE_THEME, PYTHON_LANGUAGE } from './editor-constants';

/**
 * Monaco runs its language services in web workers. Vite needs to be told it may
 * spawn them; without this the editor loads and then every worker request 404s.
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker();
  },
};

loader.config({ monaco });

const PYTHON_KEYWORDS = [
  'and',
  'as',
  'break',
  'class',
  'continue',
  'def',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'if',
  'import',
  'in',
  'is',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
  'True',
  'False',
  'None',
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
    brackets: [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ],
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
        [
          /[fFrRbB]?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/,
          'string',
        ],
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
  ['sqrt(x)', 'The square root.'],
  ['pow(base, exponent)', 'Raise base to a power.'],
  ['sin(x)', 'Sine, in radians.'],
  ['cos(x)', 'Cosine, in radians.'],
  ['tan(x)', 'Tangent, in radians.'],
  ['log(x)', 'The natural logarithm.'],
  ['exp(x)', 'e raised to x.'],
  ['floor(x)', 'The largest whole number below x.'],
  ['ceil(x)', 'The smallest whole number above x.'],
  ['round(x)', 'The nearest whole number.'],
  ['randomSeed(seed)', 'Seed the random numbers. The sketch always starts from the same seed, so a run is repeatable.'],
  ['bitRead(value, bit)', 'One bit of a number, counting from the least significant.'],
  ['pulseIn(pin, state)', 'How long a pulse on a pin lasts, in microseconds.'],
  ['tone(pin, frequency)', 'Sound a piezo on the pin, without waiting for the note to end.'],
  ['noTone(pin)', 'Stop the note.'],
  ['noInterrupts()', 'Turn interrupts off for a while. Nothing here raises one, so it changes nothing.'],
  ['interrupts()', 'Turn them back on.'],
];

const ARDUINO_OBJECTS: ReadonlyArray<
  [name: string, members: ReadonlyArray<[member: string, doc: string]>]
> = [
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
      [
        'begin(ssid, password)',
        'Start joining a network. Poll status() until it reads WL_CONNECTED.',
      ],
      ['status()', 'How the join is going, as a WL_ code. WL_IDLE_STATUS while it is in flight.'],
      ['localIP()', 'The address the network handed out, or nothing while there is none.'],
    ],
  ],
  [
    'servo',
    [
      ['attach(pin)', 'Say which pin the servo is on.'],
      ['write(angle)', 'Move it, in degrees. It stops at its real ends.'],
      ['read()', 'The angle it is at now.'],
      ['detach()', 'Let it go.'],
    ],
  ],
  [
    'dht',
    [
      ['begin(pin)', 'Say which pin the sensor is on.'],
      ['readTemperature()', 'The temperature, in degrees Celsius.'],
      ['readHumidity()', 'The humidity, in percent.'],
    ],
  ],
  [
    'sd',
    [
      ['begin(cs)', 'Say which pin is chip select.'],
      ['write(name, text)', 'Store text under a name.'],
      ['read(name)', 'The text under a name.'],
      ['exists(name)', 'Whether a name is on the card.'],
      ['remove(name)', 'Delete a name.'],
    ],
  ],
  [
    'lcd',
    [
      ['begin(columns, rows)', 'Say the size of the glass.'],
      ['setCursor(column, row)', 'Move the cursor.'],
      ['print(text)', 'Write at the cursor.'],
      ['createChar(slot, bitmap)', 'Make a character of your own.'],
      ['clear()', 'Blank the glass and home the cursor.'],
    ],
  ],
  [
    'net',
    [
      ['get(url)', 'Ask for a url. Answers whether the answer has arrived, so poll it.'],
      ['read()', 'The body of the answer, once get() has said it is here.'],
      [
        'failed()',
        'Whether the answer was a failure: a name or a path the network does not serve.',
      ],
      ['subscribe(topic)', 'Listen for messages on a topic the network publishes.'],
      ['available()', 'Whether a subscribed message is waiting to be read.'],
      ['message()', 'Read the last message. It stays readable until the next one arrives.'],
      [
        'publish(topic, payload)',
        'Send a message. Sending "2" to commands/interval asks the sensor for a reading every two seconds.',
      ],
      ['reset()', 'Forget the last request, so a new one starts from nothing.'],
    ],
  ],
];

/**
 * The libraries a sketch declares, with the declaration each one wants.
 *
 * A class is not an object: the name it is declared under is the
 * programmer's, so the completion offers the declaration rather than the
 * calls -- the calls are offered for the names the bench fixes, and those
 * are the ones a person can lean on.
 */
const ARDUINO_CLASSES: ReadonlyArray<[name: string, declaration: string, doc: string]> = [
  [
    'Servo',
    'Servo ${1:myServo};',
    'A hobby servo. attach() says which pin it is on.',
  ],
  [
    'DHT',
    'DHT ${1:mySensor}(${2:2}, ${3:DHT22});',
    'A temperature and humidity sensor. The pin is in the declaration.',
  ],
  ['SD', 'SD ${1:myCard};', 'A microSD card. begin() says which pin is chip select.'],
  [
    'LiquidCrystal',
    'LiquidCrystal ${1:myDisplay};',
    'A character LCD. begin() says the size of the glass.',
  ],
  [
    'HTTPClient',
    'HTTPClient ${1:http};',
    'A client for a url. GET() waits for the answer.',
  ],
  [
    'PubSubClient',
    "PubSubClient ${1:mqtt};",
    "A client for the network's topics.",
  ],
  [
    'WiFiUdp',
    'WiFiUdp ${1:udp};',
    'A time client. config() says which server to ask.',
  ],
];

function registerArduinoLanguage(): void {
  if (monaco.languages.getLanguages().some((language) => language.id === FIRMWARE_LANGUAGE)) {
    return;
  }

  monaco.languages.register({
    id: FIRMWARE_LANGUAGE,
    extensions: ['.ino'],
    aliases: ['Arduino', 'arduino-cpp'],
  });
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
      'void',
      'int',
      'long',
      'float',
      'double',
      'char',
      'bool',
      'const',
      'static',
      'unsigned',
      'signed',
      'struct',
      'enum',
      'return',
      'if',
      'else',
      'while',
      'do',
      'for',
      'switch',
      'case',
      'default',
      'break',
      'continue',
      'true',
      'false',
    ],
    types: [
      'void',
      'int',
      'long',
      'float',
      'double',
      'char',
      'bool',
      'String',
      // The libraries a sketch declares, which read as types where they are.
      'Servo',
      'DHT',
      'SD',
      'LiquidCrystal',
      'HTTPClient',
      'PubSubClient',
      'WiFiUdp',
    ],
    builtins: [
      ...ARDUINO_FUNCTIONS.map(([signature]) => signature.slice(0, signature.indexOf('('))),
      'setup',
      'loop',
    ],
    constants: ARDUINO_CONSTANTS.map(([name]) => name),
    tokenizer: {
      root: [
        [/^\s*#\s*\w+/, 'keyword.directive'],
        [/#\s*include\s*[<"]/, 'keyword.directive', '@include'],
        [/#\s*define/, 'keyword.directive'],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@types': 'type',
              '@constants': 'constant',
              '@builtins': 'keyword.flow',
              '@default': 'identifier',
            },
          },
        ],
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
      include: [[/[<"]/, { token: 'string', next: '@includeString' }]],
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
        ...ARDUINO_CLASSES.map(([name, declaration, doc]) => ({
          label: name,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: declaration,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: doc,
          range,
        })),
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
