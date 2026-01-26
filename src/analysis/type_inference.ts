import * as AST from "../parser/ast";
import { Scope } from "./scope";

export class TypeInference {
    infer(node: AST.Expression, scope: Scope): string {
        switch (node.type) {
            case "IntLiteral":
                return "int";
            case "FloatLiteral":
                return "float";
            case "DoubleLiteral":
                return "double";
            case "StringLiteral":
                return "string";
            case "BoolLiteral":
                return "bool";
            case "ArrayLiteral":
                return "array";

            case "Identifier": {
                const symbol = scope.resolve(node.name);
                if (symbol) {
                    return symbol.returnType || "any";
                }
                return "any";
            }

            case "BinaryExpression": {
                const left = this.infer(node.left, scope);
                const right = this.infer(node.right, scope);

                if (left === "double" || right === "double") return "double";
                if (left === "float" || right === "float") return "float";
                if (left === "int" && right === "int") return "int";
                if (left === "string" || right === "string") return "string";

                return "any";
            }

            case "CallExpression": {
                if (node.callee.type === "Identifier") {
                    const symbol = scope.resolve(node.callee.name);
                    if (symbol && symbol.returnType) {
                        return symbol.returnType;
                    }
                    if (node.callee.name === "int") return "int";
                    if (node.callee.name === "float") return "float";
                    if (node.callee.name === "double") return "double";
                    if (node.callee.name === "string") return "string";
                    if (node.callee.name === "bool") return "bool";
                }
                return "any";
            }

            case "ParenExpression":
                return this.infer(node.expression, scope);

            default:
                return "any";
        }
    }
}
