/**
 * Refund Policy Chatbot
 *
 * Demonstrates the improved prompt engineering with constraint-based consistency.
 * Uses the prompt-learning optimizer to continuously improve responses.
 */

import OpenAI from 'openai';

// Enum for refund decision categories
enum ProductCategory {
  STANDARD = 'standard',
  DIGITAL = 'digital',
  SERVICE = 'service',
  FINAL_SALE = 'final_sale'
}

interface RefundContext {
  daysSincePurchase: number;
  productCategory: ProductCategory;
  itemCondition: 'unopened' | 'opened' | 'damaged_by_customer' | 'damaged_in_shipping';
  purchaseAmount: number;
  hasOrderProof: boolean;
  returnHistory: number;
}

const IMPROVED_SYSTEM_PROMPT = `You are a customer service specialist for refund inquiries. Your role is to provide
accurate, consistent, and policy-compliant refund guidance.

CORE RULES (Follow Strictly):
1. Always verify category first: standard product, digital good, service, or final sale item
2. Check refund window (30 days from purchase)
3. Assess item condition (original packaging, damage, usage level)
4. Reference exact policy before answering

REFUND POLICY REFERENCE:
- Standard Products: 30-day refund window
  * Unopened/original packaging: Full refund to original payment method
  * Opened items: Eligible if no major damage; inspect before approval
  * Final sale items: Non-refundable (clearly marked at checkout)

- Digital Goods: No refunds (immediate delivery = consumption)
  * Exception: Defective/corrupted files (replacement only)

- Services: Prorated refunds only
  * Applies only to unused portion of service
  * Requires proof of non-usage

- Order Value Tiers:
  * < $500: Full refund to original payment method
  * >= $500: Customer chooses refund or store credit (store credit is default)

RESPONSE STRUCTURE:
1. Clarify the product category (ask if unclear)
2. State applicable refund window
3. List condition requirements
4. Provide specific refund amount/type
5. Mention next steps (return shipping, inspection)

CRITICAL EDGE CASES:
- Outside 30-day window? → Non-refundable (offer store credit alternative)
- Item damaged by customer? → Inspection required; may reduce refund amount
- No purchase proof? → Cannot process without order number
- Damaged in shipping? → Covered (full refund + return label)
- Multiple returns? → Flag after 3+ returns for fraud review

TONE: Professional, clear, policy-focused. Avoid being too flexible or apologetic
(that suggests negotiation room). Use "the policy allows..." not "I can probably...".

OUTPUT INSTRUCTIONS:
- If information is unclear, ASK for specifics rather than assuming
- Format multi-part answers with bullet points
- Always end with: "Is there anything else about your return?"`;

/**
 * RefundChatbot implements the improved prompt with constraint-based consistency
 */
export class RefundChatbot {
  private openai: OpenAI;

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Main chat handler - processes user queries with improved prompt
   */
  async processQuery(userMessage: string, context?: Partial<RefundContext>): Promise<string> {
    // Build context string if provided
    let contextString = '';
    if (context) {
      contextString = `\n\nCONTEXT:
- Days since purchase: ${context.daysSincePurchase ?? 'unknown'}
- Product category: ${context.productCategory ?? 'unknown'}
- Item condition: ${context.itemCondition ?? 'unknown'}
- Purchase amount: $${context.purchaseAmount ?? 'unknown'}
- Has order proof: ${context.hasOrderProof ?? 'unknown'}
- Previous returns: ${context.returnHistory ?? 0}`;
    }

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: IMPROVED_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: userMessage + contextString
        }
      ],
      temperature: 0.2, // Low temperature for consistency
      max_tokens: 500
    });

    return response.choices[0].message.content || 'Error: No response generated';
  }

  /**
   * Specialized handler for ambiguous queries - forces clarification
   */
  async clarifyAmbiguousQuery(userMessage: string): Promise<string> {
    const clarificationPrompt = `${IMPROVED_SYSTEM_PROMPT}

USER QUERY: "${userMessage}"

Your task: If this query is ambiguous or missing critical information (product type, timeline, condition),
ask for specific clarifications. If it's clear, proceed with the answer.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: clarificationPrompt
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      temperature: 0.1,
      max_tokens: 300
    });

    return response.choices[0].message.content || 'Error: No response generated';
  }

  /**
   * Test consistency - asks same question 3 times, returns all responses
   */
  async testConsistency(testQuery: string, runs: number = 3): Promise<string[]> {
    const responses: string[] = [];

    for (let i = 0; i < runs; i++) {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: IMPROVED_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: testQuery
          }
        ],
        temperature: 0.1, // Very low for consistency testing
        max_tokens: 400
      });

      responses.push(response.choices[0].message.content || '');
    }

    return responses;
  }

  /**
   * Evaluate response against policy compliance
   */
  async evaluatePolicyCompliance(userQuery: string, botResponse: string): Promise<{
    compliant: boolean;
    score: number;
    issues: string[];
  }> {
    const evaluationPrompt = `You are a policy compliance evaluator for a refund chatbot.

POLICY REQUIREMENTS:
1. Response clarifies product category (or asks for it)
2. Response states refund window (30 days)
3. Response addresses item condition (or asks about it)
4. Response specifies refund type (method or store credit)
5. Uses professional tone, not apologetic
6. Does not make exceptions or suggest flexibility
7. Ends with "Is there anything else about your return?"

EVALUATE THIS:
User Query: "${userQuery}"
Bot Response: "${botResponse}"

Respond in JSON format:
{
  "compliant": boolean,
  "score": number (0-100),
  "issues": string[] (list of policy violations if any)
}`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: evaluationPrompt
        }
      ],
      temperature: 0.1,
      max_tokens: 200
    });

    try {
      const text = response.choices[0].message.content || '{}';
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Return default if parsing fails
    }

    return {
      compliant: false,
      score: 0,
      issues: ['Failed to evaluate response']
    };
  }
}

// Test scenarios
export const TEST_SCENARIOS = {
  STANDARD_RETURN: {
    query: 'I bought a shirt 10 days ago and want to return it. It\'s still in the original packaging. Can I get a refund?',
    context: {
      daysSincePurchase: 10,
      productCategory: ProductCategory.STANDARD,
      itemCondition: 'unopened',
      purchaseAmount: 49.99,
      hasOrderProof: true,
      returnHistory: 0
    },
    expectedElements: ['30 days', 'full refund', 'original payment method', 'return label', 'order number']
  },

  OUTSIDE_WINDOW: {
    query: 'I want to return boots I bought 6 weeks ago. They\'re worn but not damaged.',
    context: {
      daysSincePurchase: 42,
      productCategory: ProductCategory.STANDARD,
      itemCondition: 'opened',
      purchaseAmount: 129.99,
      hasOrderProof: true,
      returnHistory: 0
    },
    expectedElements: ['outside 30-day', 'non-refundable', 'store credit', 'alternative']
  },

  DIGITAL_GOOD: {
    query: 'I bought an e-book yesterday. I don\'t like it. Can I get a refund?',
    context: {
      daysSincePurchase: 1,
      productCategory: ProductCategory.DIGITAL,
      itemCondition: 'unopened',
      purchaseAmount: 12.99,
      hasOrderProof: true,
      returnHistory: 0
    },
    expectedElements: ['digital goods', 'non-refundable', 'immediate delivery', 'defective']
  },

  NO_ORDER_PROOF: {
    query: 'Can I return something without my order number?',
    context: {
      daysSincePurchase: 15,
      productCategory: ProductCategory.STANDARD,
      itemCondition: 'unopened',
      purchaseAmount: 99.99,
      hasOrderProof: false,
      returnHistory: 0
    },
    expectedElements: ['order number', 'proof of purchase', 'cannot']
  },

  CUSTOMER_DAMAGE: {
    query: 'I dropped it and cracked the screen. Can I still return it?',
    context: {
      daysSincePurchase: 20,
      productCategory: ProductCategory.STANDARD,
      itemCondition: 'damaged_by_customer',
      purchaseAmount: 299.99,
      hasOrderProof: true,
      returnHistory: 0
    },
    expectedElements: ['inspection required', 'may reduce', 'customer damage', 'assessment']
  },

  SHIPPING_DAMAGE: {
    query: 'Box arrived damaged. Item broken.',
    context: {
      daysSincePurchase: 2,
      productCategory: ProductCategory.STANDARD,
      itemCondition: 'damaged_in_shipping',
      purchaseAmount: 199.99,
      hasOrderProof: true,
      returnHistory: 0
    },
    expectedElements: ['shipping protection', 'full refund', 'return label', 'covered']
  },

  HIGH_VALUE: {
    query: 'Returning a $3,000 laptop purchased 2 weeks ago',
    context: {
      daysSincePurchase: 14,
      productCategory: ProductCategory.STANDARD,
      itemCondition: 'unopened',
      purchaseAmount: 3000,
      hasOrderProof: true,
      returnHistory: 0
    },
    expectedElements: ['store credit', 'over $500', 'default', 'request refund']
  },

  FRAUD_SIGNAL: {
    query: 'This is my 5th return in 3 months',
    context: {
      daysSincePurchase: 20,
      productCategory: ProductCategory.STANDARD,
      itemCondition: 'opened',
      purchaseAmount: 79.99,
      hasOrderProof: true,
      returnHistory: 5
    },
    expectedElements: ['review', 'flagged', 'processing', 'delay']
  },

  AMBIGUOUS: {
    query: 'What\'s your return policy?',
    context: undefined,
    expectedElements: ['clarify', 'type', 'product', 'when', 'condition']
  }
};
