lexer grammar VelocityHtmlLexer;

@lexer::header { 
   import { Interval } from 'antlr4ts/misc/Interval';
} 
//@lexer::members { function memberHello() {console.log("hello, Member!");}}
@lexer::members {

  private vtlPrefixes = ['if', 'foreach', 'end', 'set'];
  private maxVtlPrefixLength = this.vtlPrefixes.reduce((maxLength, vtlPrefix) => {
    return Math.max(maxLength, vtlPrefix.length);
  }, 0);

  private toCodePoints(characters: string[] | string): Set<number> {
    // TODO Fix Me
    return (characters instanceof Array? characters : characters.split("")).map(character => character.codePointAt(0)).reduce((set, codePoint) => {
      if (codePoint != null && !set.has(codePoint)) {
        set.add(codePoint);
      }
      return set;
    }, new Set<number>());
  }
  private vtlStart = this.toCodePoints(["#", "$"]);
  private vtlValidAlpha = this.toCodePoints("abcdefghijklmnopqrstuvwxyz");
  private vtlValidAlphaNumeric = this.toCodePoints("abcdefghijklmnopqrstuvwxyz0123456789")
  private vtlOperators = this.toCodePoints([".", "(", "["]);
  private vtlWhitespace = this.toCodePoints([" ", "\t", "\n", "\r", "\f"]);
  private vtlAll = new Set([...this.vtlValidAlphaNumeric, ...this.vtlOperators, ...this.vtlWhitespace])
  // $\u007B
  private isStartOfVtlReference(offset: number = 0): boolean {
    let index = 0;
    let vtlDirectiveStart = false;
    let vtlReferenceStart = false;
    let isVtlReference = false;
    let isVtlDirective = false;
    while(true) {
      const startPosition = this._tokenStartCharIndex + index;
      if (startPosition >= this.inputStream.size) {
        return isVtlReference;
      }
      const characterInStream = this.inputStream.getText(Interval.of(startPosition, startPosition));
      const codePoint = characterInStream.toLowerCase().codePointAt(0);
      if (codePoint == null) {
        // ?
        return false;
      }
      if (index == 0) {
        if ("#".codePointAt(0) == codePoint) {
          vtlDirectiveStart = true;
        } else if ("$".codePointAt(0) == codePoint) {
          vtlReferenceStart = true;
        } else {
          return false;
        }
      } else {
        if (vtlReferenceStart) {
          if (index == 1) {
            // TODO Test Numbers
            if (!this.vtlValidAlpha.has(codePoint)) {
              return false;
            }
            isVtlReference = true;
          } else {
            if (this.vtlOperators.has(codePoint)) {
                this.pushMode(VelocityHtmlLexer.VELOCITY_REFERENCE_MODE);
              return true;
            } else if (!this.vtlValidAlpha.has(codePoint)) {
              return true;
            }
          }
        } else {
          const nextCharacters = this.getNextCharacters(this.maxVtlPrefixLength, 1);
          for (let vtlDirective of this.vtlPrefixes) {
            if (nextCharacters.startsWith(vtlDirective)) {
              return true;
            }
          }
        }
      }
      index++;
    } 
  }

  private popModeIfNecessary(): void {
    const characterInStream = this.inputStream.getText(Interval.of((this.inputStream as any)._position, (this.inputStream as any)._position));
    const codePoint = characterInStream.toLowerCase().codePointAt(0);
    if (codePoint == null) {
      // ?
      return;
    }
    if (!this.vtlAll.has(codePoint)) {
      this.popMode();
    }
  }

   private isNotStartOfConditionalComment(): boolean {
      const nextCharacters = this.getNextCharacters(4);
      return nextCharacters !== '<!--[';
   }

   private getNextCharacters(numberOfCharacters:number, offset = 0) {
     const currentPosition = this._tokenStartCharIndex + offset;
     const nextCharacters = this.inputStream.getText(Interval.of(currentPosition, currentPosition + numberOfCharacters));
     this.debug('nextCharacters', nextCharacters);
     return nextCharacters;
   }

   public isVtlReferenceInsideString = false;

   public nextTagCloseMode : number | null = null;

   public popModeForCurrentTag() : void {
     this.debug(`before ${this.text}`, this.printModeStack());
     if (this.nextTagCloseMode != null) {
      this.mode(this.nextTagCloseMode);
      this.nextTagCloseMode = null;
     } else {
      this.popMode();
     }
     this.debug(`after ${this.text}`, this.printModeStack());
  }

  public printModeStack() {
    const modeStack = this._modeStack.toArray();
    return `mode: ${this._mode}, modeStack: ${modeStack.length === 0? '<empty>' : modeStack}`;
  }

  private rcDataTags = ["script", "pre", "textarea", "title"];
  private tagName: string | null = null;

	public setNextTagCloseMode() {
    this.tagName = this.text.substring(1).toLowerCase();
    this.nextTagCloseMode = this.rcDataTags.includes(this.tagName)? VelocityHtmlLexer.RCDATA_MODE : VelocityHtmlLexer.DEFAULT_MODE;
  }

  private makeVtlReferenceInsideToken(): void {
  }

  public isDebugEnabled = false;

  private debug(...something: any[]): void {
    if (this.isDebugEnabled) {
      console.log.apply(undefined, something);
    }
  }

  public isCurrentTagName(): boolean {
  const tagName = this.text
      .substring(2, this.text.length - 1)
      .trim()
      .toLowerCase();
    return tagName === this.tagName;
  }
}


IE_COMMENT_START: '<!--[' ~[\]]+ ']>';

IE_COMMENT_CLOSE: '<![endif]-->';

// Slurp whitespace after comment to avoid handling of whitespace between comment and node that it should attach to.
IE_REVEALED_COMMENT_START: '<!--[' ~[\]]+ ']><!-->' DEFAULT_WS*;
// Same as above
IE_REVEALED_COMMENT_CLOSE: DEFAULT_WS* '<!--<![endif]-->';

// See revealed comment
PRETTIER_IGNORE: '<!--' DEFAULT_WS* 'prettier-ignore' DEFAULT_WS* '-->' DEFAULT_WS*;

// Comment that is NOT an IE comment.
// Using (~[[] .*?)? breaks non-greediness
COMMENT: {this.isNotStartOfConditionalComment()}? '<!--' .*? '-->';

CDATA: '<![CDATA['~[\]]*? ']]>';

// doctype case-insensitive
DOCTYPE_START: '<!' [dD] [oO] [cC] [tT] [yY] [pP] [eE] -> pushMode(DOCTYPE_MODE);

// Text inside certain tags must be tokenized as RCDATA, because <> are valid characters.
// See RCDATA_MODE for more information.
TAG_START_OPEN: '<' HTML_LIBERAL_NAME  { this.setNextTagCloseMode() } -> pushMode(TAG_MODE);

TAG_END: '<' '/' HTML_LIBERAL_NAME DEFAULT_WS* '>';

// TODO Try to break this
VTL_COMMENT: [ \t]* '##' ~[\n\r\f]*;

VTL_MULTILINE_COMMENT: '#*' ( ~[*] | ('*' ~[#]) )* '*#';

VTL_DIRECTIVE_START : '#' ('foreach'|'if'|'set') VTL_WS* '(' -> pushMode(VELOCITY_MODE);

VTL_DIRECTIVE_END: '#end';

VTL_VARIABLE: '$' VTL_IDENTIFIER;

HTML_TEXT: {!this.isStartOfVtlReference()}? ~[ \t\n\r\f<]+;

WS
   : DEFAULT_WS +
   ;


fragment DEFAULT_WS: [ \t\n\r\f] ; 

// handle characters which failed to match any other token
ERROR_CHARACTER : . ;

fragment VTL_REFERENCE_START: '$' '{';


mode VELOCITY_REFERENCE_MODE;

VTL_REFERENCE_IDENTIFIER: VTL_IDENTIFIER {this.popModeIfNecessary()} -> type(VTL_IDENTIFIER);

VTL_REFERENCE_DOT: '.' -> type(VTL_DOT);

VTL_REFERENCE_PARENS_OPEN: '(' -> type(VTL_PARENS_OPEN), pushMode(VELOCITY_MODE);

VTL_REFERENCE_INDEX_OPEN: '[' -> type(VTL_INDEX_OPEN), pushMode(VELOCITY_MODE);

VTL_REFERENCE_WS: DEFAULT_WS -> type(WS), popMode;

VTL_REFERENCE_ERROR_CHARACTER: . -> type(ERROR_CHARACTER);


// TODO Velocity variable. Keep preformatted:
// - $122.22
//  Example from user_guide.
mode VELOCITY_MODE;

VTL_KEYWORD: 'in' | '=' | ',';

VTL_DOT: '.';

VTL_IDENTIFIER: [a-zA-Z][a-zA-Z0-9_]* { this.makeVtlReferenceInsideToken() };

// TODO Velocity terminology

VTL_INDEX_OPEN: '[' -> pushMode(VELOCITY_MODE);

VTL_INDEX_CLOSE: ']' -> popMode;

VTL_PARENS_OPEN: '(' -> pushMode(VELOCITY_MODE);

VTL_PARENS_CLOSE: ')'  -> popMode;

VTL_REFERENCE: '$' VTL_IDENTIFIER;

// VTL_VALUE
//    : VTL_STRING
//    | VTL_NUMBER
//    | VTL_REFERENCE;

VTL_STRING
   : '"' (('\\' ~[\\\u0000-\u001F]) |  ~ ["\\\u0000-\u001F])* '"'
   | '\'' (('\\' ~[\\\u0000-\u001F]) |  ~ ['\\\u0000-\u001F])* '\''
   ;

// TODO VTL Variables in CSS. Do not format CSS

VTL_NUMBER
   : [1-9][0-9]* | '0';

VTL_WS
   : DEFAULT_WS +  -> type(WS)
   ;

VTL_ERROR_CHARACTER: . -> type(ERROR_CHARACTER);

mode TAG_MODE;
// Mix between tag name and attribute name:
// Tag open state: ASCII alpha https://html.spec.whatwg.org/#tag-open-state
// Tag name state: Not tab, lf, ff, space, solidus, > https://html.spec.whatwg.org/#tag-name-state
// Attribute name: https://html.spec.whatwg.org/#attribute-name-state
fragment HTML_LIBERAL_NAME: ~[ \t\n\r\f/><="']+;

HTML_NAME: HTML_LIBERAL_NAME;
EQUAL: '=';
// \- since - means "range" inside [...]

HTML_STRING
   : '"' ( VALID_ESCAPES |  ~ ["])* '"'
   // Unescaped one must not contain spaces
   | '\'' ( VALID_ESCAPES |  ~ ['])* '\''
   ;

// TODO Does this make sense?
fragment VALID_ESCAPES: '\\' ~[\\\u0000-\u001F];

// HTML_INSIDE_TAG_STRING_VTL_REFERENCE: '"' VTL_REFERENCE_START { this.isVtlReferenceInsideString = true} -> skip, pushMode(INSIDE_VELOCITY_REFERENCE);

TAG_CLOSE: '>' { this.popModeForCurrentTag() };
SELF_CLOSING_TAG_CLOSE :'/' '>' -> popMode;

// HTML_TAG_VTL:  VTL_REFERENCE_START -> skip, pushMode(INSIDE_VELOCITY_REFERENCE);

HTML_WS
   : DEFAULT_WS -> skip
   ;

HTML_ERROR_CHARACTER: . -> type(ERROR_CHARACTER);

mode DOCTYPE_MODE;

// https://html.spec.whatwg.org/multipage/parsing.html#before-doctype-name-state
DOCTYPE_TYPE: ~[ \t\n\r\f>] +;

DOCTYPE_WS: DEFAULT_WS + -> skip;

DOCTYPE_END: '>' -> popMode;

DOCTYPE_ERROR_CHARACTER: . -> type(ERROR_CHARACTER);

mode RCDATA_MODE;

// Script state only changes on closing script tag: https://html.spec.whatwg.org/#script-data-less-than-sign-state
// TODO Space after t possible?
SCRIPT_END_TAG:  '</'HTML_LIBERAL_NAME '>' {this.isCurrentTagName()}? -> mode(DEFAULT_MODE), type(TAG_END);

// All other valid tags (ASCII alpha: https://html.spec.whatwg.org/#script-data-end-tag-open-state)
SCRIPT_OTHER_CLOSING_TAG: '<' '/'? HTML_LIBERAL_NAME -> type(HTML_TEXT);

SCRIPT_TEXT: (~[ \t\n\r\f<]+ | '<') -> type(HTML_TEXT);

SCRIPT_WS: DEFAULT_WS -> type(HTML_TEXT);

SCRIPT_ERROR_CHARACTER: . -> type(ERROR_CHARACTER);
