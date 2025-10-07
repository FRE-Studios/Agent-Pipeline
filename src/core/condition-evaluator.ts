// src/core/condition-evaluator.ts

import { PipelineState } from '../config/schema.js';

export class ConditionEvaluator {
  /**
   * Evaluate a condition expression against pipeline state
   * @param condition - Template expression like "{{ stages.code-review.outputs.issues > 0 }}"
   * @param state - Current pipeline state
   * @returns Evaluation result (true/false)
   */
  evaluate(condition: string, state: PipelineState): boolean {
    try {
      // Extract expression from template syntax
      const expression = this.extractExpression(condition);

      // Build context object for evaluation
      const context = this.buildContext(state);

      // Parse and evaluate the expression
      return this.evaluateExpression(expression, context);
    } catch (error) {
      console.error(`❌ Condition evaluation failed: ${condition}`);
      console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      // Default to false on error to skip the stage
      return false;
    }
  }

  /**
   * Extract expression from template syntax {{ ... }}
   */
  private extractExpression(condition: string): string {
    const match = condition.match(/\{\{\s*(.+?)\s*\}\}/);
    if (!match) {
      throw new Error(`Invalid condition syntax: ${condition}. Expected {{ expression }}`);
    }
    return match[1].trim();
  }

  /**
   * Build context object with access to pipeline state
   */
  private buildContext(state: PipelineState): Record<string, any> {
    const context: Record<string, any> = {
      stages: {}
    };

    // Build stages object with outputs
    for (const stage of state.stages) {
      if (stage.status === 'success' && stage.extractedData) {
        context.stages[stage.stageName] = {
          status: stage.status,
          outputs: stage.extractedData,
          duration: stage.duration,
          commitSha: stage.commitSha
        };
      }
    }

    return context;
  }

  /**
   * Evaluate expression using safe evaluation
   * Supports: comparison operators, logical operators, property access
   */
  private evaluateExpression(expression: string, context: Record<string, any>): boolean {
    // Replace property access with safe navigation
    let safeExpression = expression;

    // Find all property access patterns (e.g., stages.code-review.outputs.issues)
    const propertyPattern = /stages\.[\w-]+(?:\.[\w-]+)*/g;
    const properties = expression.match(propertyPattern) || [];

    for (const prop of properties) {
      const value = this.resolveProperty(prop, context);
      // Replace property with its value (as JSON string to preserve type)
      safeExpression = safeExpression.replace(
        new RegExp(prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        JSON.stringify(value)
      );
    }

    // Now evaluate the expression
    // We use a simple parser for safety instead of eval()
    return this.parseAndEvaluate(safeExpression);
  }

  /**
   * Resolve property path like "stages.code-review.outputs.issues"
   */
  private resolveProperty(path: string, context: Record<string, any>): any {
    const parts = path.split('.');
    let current: any = context;

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Parse and evaluate expression safely
   * Supports: ==, !=, >, <, >=, <=, &&, ||
   */
  private parseAndEvaluate(expression: string): boolean {
    // Handle logical OR (||)
    if (expression.includes('||')) {
      const parts = expression.split('||').map(p => p.trim());
      return parts.some(part => this.parseAndEvaluate(part));
    }

    // Handle logical AND (&&)
    if (expression.includes('&&')) {
      const parts = expression.split('&&').map(p => p.trim());
      return parts.every(part => this.parseAndEvaluate(part));
    }

    // Handle comparison operators
    const comparisonMatch = expression.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (comparisonMatch) {
      const [, left, operator, right] = comparisonMatch;
      const leftValue = this.parseValue(left.trim());
      const rightValue = this.parseValue(right.trim());

      switch (operator) {
        case '==':
          return leftValue == rightValue;
        case '!=':
          return leftValue != rightValue;
        case '>':
          return Number(leftValue) > Number(rightValue);
        case '<':
          return Number(leftValue) < Number(rightValue);
        case '>=':
          return Number(leftValue) >= Number(rightValue);
        case '<=':
          return Number(leftValue) <= Number(rightValue);
      }
    }

    // Handle boolean literals
    if (expression === 'true') return true;
    if (expression === 'false') return false;

    // Handle undefined/null as false
    const value = this.parseValue(expression);
    if (value === undefined || value === null) return false;

    // Truthy check
    return Boolean(value);
  }

  /**
   * Parse value from string (handles numbers, strings, booleans, null/undefined)
   */
  private parseValue(str: string): any {
    str = str.trim();

    // JSON values (numbers, booleans, strings, null)
    try {
      return JSON.parse(str);
    } catch {
      // If JSON.parse fails, return as string
      return str;
    }
  }

  /**
   * Validate condition syntax (can be called before execution)
   */
  validateSyntax(condition: string): { valid: boolean; error?: string } {
    try {
      this.extractExpression(condition);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
