import { CharStreams, CommonTokenStream, Recognizer, Token } from "antlr4ts";
import { ATNSimulator } from "antlr4ts/atn/ATNSimulator";
import { AST } from "prettier";
import { VelocityHtmlLexer } from "./generated/VelocityHtmlLexer";
import {
  HtmlCdataNode,
  HtmlCloseNode,
  HtmlCommentNode,
  HtmlDocTypeNode,
  HtmlTagNode,
  HtmlTextNode,
  IeConditionalCommentNode,
  NodeWithChildren,
  NodeWithChildrenDecoration,
  ParserNode,
  DecoratedNode,
  RootNode,
  VelocityDirectiveNode,
  VelocityCommentNode,
} from "./VelocityParserNodes";
import { VelocityToken } from "./VelocityToken";
import { VelocityTokenFactory } from "./VelocityTokenFactory";

const interpolateErrorMsg = (msg: string, tokenName: string, mode: string) => {
  const ctx = {
    tokenName,
    mode,
  };
  return Object.entries(ctx).reduce((interpolatedMsg, [key, value]) => {
    return interpolatedMsg.replace(
      new RegExp(`{{\\w*${key}\\w*}}`, "g"),
      value
    );
  }, msg);
};
export class ParserException extends Error {
  // loc is read by prettier error handler
  public loc: {
    start: {
      column: number;
      line: number;
    };
  };
  constructor(
    token: VelocityToken,
    mode: string,
    recognizer: Recognizer<unknown, ATNSimulator>,
    msg?: string
  ) {
    const tokenName =
      recognizer != null
        ? recognizer.vocabulary.getDisplayName(token.type)
        : token.type;
    super(
      interpolateErrorMsg(
        msg != null ? msg : `Unexpected token <{{tokenName}}> in mode {{mode}}`,
        tokenName.toString(),
        mode
      )
    );
    this.loc = {
      start: {
        column: token.startLocation.column,
        line: token.startLocation.line,
      },
    };
  }
}

// TODO Rename mode
type LexerMode =
  | "tagOpen"
  | "attributeLHS"
  | "attributeRHS"
  | "outsideTag"
  | "tagClose"
  | "doctype"
  | "velocity";

export default function parse(
  text: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parsers: unknown,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options: unknown
): AST {
  const inputStream = CharStreams.fromString(text);
  const lexer = new VelocityHtmlLexer(inputStream);
  const tokenFactory = new VelocityTokenFactory(lexer);
  lexer.tokenFactory = tokenFactory;
  const errors: Error[] = [];
  lexer.removeErrorListeners();
  lexer.addErrorListener({
    syntaxError(
      recognizer: Recognizer<Token, ATNSimulator>,
      offendingSymbol,
      line,
      charPositionInLine,
      msg,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      e
    ) {
      errors.push(new Error(msg));
    },
  });
  const tokenStream = new CommonTokenStream(lexer);
  tokenStream.fill();

  const rootNode = new RootNode();
  const parentStack: NodeWithChildren[] = [rootNode];
  const tokens = tokenStream.getTokens();
  let currentNode: ParserNode = rootNode;
  let currentHtmlAttribute: VelocityToken | null = null;

  let mode: LexerMode = "outsideTag";

  let revealedConditionalComment: VelocityToken | null = null;
  let prettierIgnore: VelocityToken[] = [];
  let velocityModeStack: LexerMode[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token: VelocityToken = tokens[i] as VelocityToken;
    const newParserException = (msg?: string) =>
      new ParserException(token, mode, lexer, msg);
    let nextToken: Token | undefined;
    // Not every node is a parent.
    if (i < tokens.length - 1) {
      nextToken = tokens[i + 1];
    }

    const popParentStack = (): void => {
      if (currentNode.endLocation == null) {
        throw newParserException("endToken of currentNode is null");
      }
      parentStack.shift();
      currentNode = parentStack[0];
    };

    switch (mode) {
      case "outsideTag": {
        if (!(currentNode instanceof NodeWithChildren)) {
          throw newParserException();
        }
        // Concatenate text to be able to use fill() later.
        const addTextNode = (token: VelocityToken) => {
          const lastChild = (currentNode as NodeWithChildren).lastChild;
          if (lastChild != null && lastChild instanceof HtmlTextNode) {
            lastChild.addText(token);
          } else {
            (currentNode as NodeWithChildren).addChild(new HtmlTextNode(token));
          }
        };
        const setNewCurrentNode = (node: ParserNode): ParserNode => {
          currentNode = node;
          addChild(node);
          return node;
        };
        const addChild = (node: ParserNode): ParserNode => {
          parentStack[0].addChild(node);
          return node;
        };
        switch (token.type) {
          case VelocityHtmlLexer.TAG_START_OPEN: {
            const tagName = token.textValue
              .substring(1, token.textValue.length)
              .trim();
            const node = new HtmlTagNode(token);
            node.tagName = tagName;
            setNewCurrentNode(node);
            mode = "attributeLHS";
            break;
          }
          case VelocityHtmlLexer.EOF: {
            break;
          }
          case VelocityHtmlLexer.TAG_END: {
            const tagName = token.textValue
              .substring(2, token.textValue.length - 1)
              .trim();
            if (currentNode instanceof HtmlTagNode) {
              if (currentNode.tagName.toLowerCase() != tagName.toLowerCase()) {
                throw newParserException(
                  `Tag was opened with ${currentNode.tagName}, but closed with ${tagName}. Mixed tags are not supported.`
                );
              }
              currentNode.endNode = new NodeWithChildrenDecoration();
            } else if (
              currentNode instanceof HtmlCloseNode ||
              currentNode instanceof IeConditionalCommentNode
            ) {
              const closeNode = new HtmlCloseNode(token);
              closeNode.tagName = tagName;
              /*
               * This is an incomplete html snippet. Assemble the tree "bottom-up".
               * </td><td></td></tr></table>
               * should be parsed as
               * Root
               *  - /table
               *    - /tr
               *      - /td
               *      - td
               */
              parentStack[0].children.forEach((child) => {
                closeNode.addChild(child);
              });
              parentStack[0].children = [];
              setNewCurrentNode(closeNode);
              parentStack.unshift(currentNode);
            } else {
              throw newParserException();
            }

            currentNode.endToken = token;
            popParentStack();

            break;
          }
          case VelocityHtmlLexer.IE_COMMENT_START: {
            const conditionalCommentNode = new IeConditionalCommentNode(token);
            setNewCurrentNode(conditionalCommentNode);
            parentStack.unshift(currentNode);

            mode = "outsideTag";
            break;
          }
          case VelocityHtmlLexer.IE_COMMENT_CLOSE: {
            // Remove dangling nodes from parent stack
            while (!(currentNode instanceof IeConditionalCommentNode)) {
              parentStack.shift();
              currentNode = parentStack[0];
            }
            currentNode.endNode = new NodeWithChildrenDecoration();
            currentNode.endToken = token;
            popParentStack();
            break;
          }
          case VelocityHtmlLexer.COMMENT: {
            addChild(new HtmlCommentNode(token));
            break;
          }
          case VelocityHtmlLexer.HTML_TEXT:
          case VelocityHtmlLexer.WS: {
            addTextNode(token);
            break;
          }
          case VelocityHtmlLexer.DOCTYPE_START: {
            setNewCurrentNode(new HtmlDocTypeNode(token));
            mode = "doctype";
            break;
          }
          case VelocityHtmlLexer.CDATA: {
            addChild(new HtmlCdataNode(token));
            break;
          }
          case VelocityHtmlLexer.IE_REVEALED_COMMENT_START: {
            revealedConditionalComment = token;
            break;
          }
          case VelocityHtmlLexer.IE_REVEALED_COMMENT_CLOSE: {
            if (revealedConditionalComment == null) {
              // Attach to previous comment
              // See below
              revealedConditionalComment = token;
            } else {
              // Remove empty conditional comment.
              revealedConditionalComment = null;
            }
            break;
          }
          case VelocityHtmlLexer.PRETTIER_IGNORE: {
            prettierIgnore.push(token);
            break;
          }
          case VelocityHtmlLexer.VTL_DIRECTIVE_START: {
            const node = new VelocityDirectiveNode(token);
            setNewCurrentNode(node);
            if (node.hasChildren) {
              parentStack.unshift(currentNode);
            }
            velocityModeStack = ["outsideTag"];
            mode = "velocity";
            break;
          }
          case VelocityHtmlLexer.VTL_DIRECTIVE_END: {
            popParentStack();
            break;
          }
          case VelocityHtmlLexer.VTL_COMMENT:
          case VelocityHtmlLexer.VTL_MULTILINE_COMMENT: {
            addChild(new VelocityCommentNode(token));
            break;
          }
          default: {
            throw newParserException();
          }
        }

        if (
          prettierIgnore.length > 0 &&
          token.type != VelocityHtmlLexer.PRETTIER_IGNORE
        ) {
          let lastNode: ParserNode | undefined = parentStack[0].lastChild;
          lastNode =
            lastNode != null &&
            // TODO Was wenn es kein WS gibt?
            !(lastNode instanceof HtmlTextNode && lastNode.isWhitespaceOnly)
              ? lastNode
              : currentNode;

          if (lastNode == null) {
            // TODO Add as normal comment node?
            throw newParserException(
              `Cannot attach prettier ignore. No last child.`
            );
          }

          lastNode.prettierIgnore = prettierIgnore;
          prettierIgnore = [];
        }

        if (
          revealedConditionalComment != null &&
          token.type != VelocityHtmlLexer.IE_REVEALED_COMMENT_START
        ) {
          /**
           * Attach to the last node:
           * 1. The last child:
           * <!--[if lt IE 9]><!-->
           *  <html>
           * 2. The current node:
           *  <html>
           * <!--<![endif]-->
           */
          let lastNode: DecoratedNode | undefined = parentStack[0].lastChild;
          lastNode =
            lastNode != null &&
            // TODO Preserve newlines after <!--[if lt IE 9]><!-->
            !(lastNode instanceof HtmlTextNode && lastNode.isWhitespaceOnly)
              ? lastNode
              : currentNode;
          if (lastNode == null) {
            throw newParserException(
              `Cannot attach conditional comment. No last child.`
            );
          }

          if (lastNode instanceof NodeWithChildren) {
            if (lastNode.endNode == null) {
              lastNode = lastNode.startNode;
            } else {
              lastNode = lastNode.endNode;
            }
          }
          if (token.type == VelocityHtmlLexer.IE_REVEALED_COMMENT_CLOSE) {
            lastNode.revealedConditionalCommentEnd = revealedConditionalComment;
          } else {
            lastNode.revealedConditionalCommentStart =
              revealedConditionalComment;
          }
          revealedConditionalComment = null;
        }
        break;
      }
      case "attributeLHS": {
        if (!(currentNode instanceof HtmlTagNode)) {
          throw newParserException();
        }
        switch (token.type) {
          case VelocityHtmlLexer.HTML_NAME:
          case VelocityHtmlLexer.HTML_STRING: {
            if (
              nextToken != null &&
              nextToken.type !== VelocityHtmlLexer.EQUAL
            ) {
              currentNode.addAttribute(token);
            } else {
              currentHtmlAttribute = token;
              i++;
              mode = "attributeRHS";
            }
            break;
          }
          case VelocityHtmlLexer.SELF_CLOSING_TAG_CLOSE:
          case VelocityHtmlLexer.TAG_CLOSE: {
            const isSelfClosing =
              currentNode.isSelfClosing ||
              token.type == VelocityHtmlLexer.SELF_CLOSING_TAG_CLOSE;
            currentNode.isSelfClosing = isSelfClosing;
            if (!isSelfClosing) {
              parentStack.unshift(currentNode);
            } else {
              // Self closing tags must not be added to the parent stack.
              currentNode.endToken = token;
              currentNode = parentStack[0];
            }
            mode = "outsideTag";
            break;
          }
          default: {
            throw newParserException();
          }
        }
        break;
      }
      case "attributeRHS": {
        if (!(currentNode instanceof HtmlTagNode)) {
          throw newParserException();
        }
        if (currentHtmlAttribute == null) {
          throw newParserException();
        }
        switch (token.type) {
          case VelocityHtmlLexer.HTML_NAME:
          case VelocityHtmlLexer.HTML_STRING: {
            currentNode.addAttribute(currentHtmlAttribute, token);
            currentHtmlAttribute = null;
            mode = "attributeLHS";
            break;
          }
          default: {
            throw newParserException();
          }
        }
        break;
      }
      case "doctype": {
        if (!(currentNode instanceof HtmlDocTypeNode)) {
          throw newParserException();
        }
        switch (token.type) {
          case VelocityHtmlLexer.DOCTYPE_TYPE: {
            currentNode.types.push(token.textValue);
            break;
          }
          case VelocityHtmlLexer.DOCTYPE_END: {
            currentNode.endToken = token;
            // TODO Duplicated logic
            currentNode = parentStack[0];
            mode = "outsideTag";
            break;
          }
          default: {
            throw newParserException();
          }
        }
        break;
      }
      case "velocity": {
        if (!(currentNode instanceof VelocityDirectiveNode)) {
          throw newParserException();
        }
        switch (token.type) {
          case VelocityHtmlLexer.WS:
          case VelocityHtmlLexer.VTL_REFERENCE:
          case VelocityHtmlLexer.VTL_KEYWORD:
          case VelocityHtmlLexer.VTL_DOT:
          case VelocityHtmlLexer.VTL_IDENTIFIER:
          case VelocityHtmlLexer.VTL_STRING: {
            currentNode.tokens.push(token);
            break;
          }
          case VelocityHtmlLexer.VTL_PARENS_OPEN: {
            currentNode.tokens.push(token);
            velocityModeStack.push("velocity");
            break;
          }
          case VelocityHtmlLexer.VTL_PARENS_CLOSE: {
            if (velocityModeStack.length == 0) {
              throw newParserException("Velocity mode stack is empty");
            }
            currentNode.tokens.push(token);
            mode = velocityModeStack.pop()!;
            if (velocityModeStack.length == 0 && !currentNode.hasChildren) {
              currentNode = parentStack[0];
            }
            break;
          }
          default: {
            throw newParserException();
          }
        }
        break;
      }
      default: {
        throw newParserException();
      }
    }
  }
  return rootNode;
}
