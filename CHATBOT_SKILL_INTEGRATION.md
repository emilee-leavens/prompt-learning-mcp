# Refund Chatbot + Automatic Prompt Improver: Integration Guide

## Overview

The **automatic-stateful-prompt-improver** skill can enhance your refund chatbot by:
- Continuously learning from real customer interactions
- Iteratively refining the prompt based on performance metrics
- Building an embedding-indexed history of high-performing variations
- Auto-optimizing on future similar requests

This document shows how to integrate the skill with the refund policy chatbot analysis.

---

## Part 1: Setup - Enable the Skill

### Prerequisites

1. **MCP Server Running**
   ```bash
   npm run setup  # Starts Qdrant + Redis
   ```

2. **OpenAI API Key Set**
   ```bash
   export OPENAI_API_KEY=sk-...
   ```

3. **Skill Activated**
   The skill is in your collection: `automatic-stateful-prompt-improver/SKILL.md`

---

## Part 2: First-Run Optimization

### Initial Optimization Flow

When you first deploy the refund chatbot, trigger optimization:

```
User Request: "Optimize the refund chatbot prompt for consistency"

Skill Action:
1. INTERCEPT: Detect this is a prompt engineering task (complexity: HIGH)
2. CALL: optimize_prompt
   - prompt: [current refund system prompt]
   - domain: "refund_policy"
   - max_iterations: 15  (high complexity)
3. RECEIVE: Optimized prompt variants with scores
4. INFORM: "I've refined your prompt using APE pattern. 
            Clarity improved 23%, specificity +18%"
5. RETURN: Best variant to use
```

### What Happens Behind the Scenes

**APE (Automatic Prompt Engineer) Pattern:**
- Generates 5-7 prompt instruction variants
- Evaluates each on your test scenarios
- Ranks by performance on consistency + compliance metrics
- Returns top performer

**OPRO (Optimization by Prompting) Pattern:**
- Uses the best variant as baseline
- Iterates with feedback: "Try making constraints more explicit"
- Refinement converges when improvement < 1% for 3 iterations

**Result:** Prompt improves 20-40% on first run

---

## Part 3: Production Learning Loop

### Continuous Improvement Workflow

```
PRODUCTION (Daily)
    ↓
1. Customer asks refund question
    ↓
2. Chatbot responds using current system prompt
    ↓
3. Capture metrics:
   - Was answer correct? (binary)
   - Did customer understand? (follow-up needed?)
   - Time to resolve?
    ↓
4. Call: record_feedback
   {
     "prompt_id": "refund-policy-v1.0",
     "success": true,
     "quality_score": 0.92,
     "outcome": {
       "success": true,
       "latency_ms": 1200,
       "output_tokens": 342,
       "quality_score": 0.92
     },
     "user_feedback": {
       "satisfaction": 5,
       "comments": "Clear explanation of 30-day window"
     }
   }
    ↓
5. Vector DB stores performance history
    ↓
6. Every 100 interactions → Trigger retrieve_prompts
   (Find similar high-performing variations)
    ↓
7. Every 500 interactions → Trigger optimize_prompt
   (Generate new variants based on failure patterns)
    ↓
8. Every month → Trigger get_analytics
   (See trends: What's working? What's failing?)
```

### Example: Weekly Optimization

**Scenario:** After 500 customer interactions, you notice:
- Consistency: 97% ✅ (target: 95%+)
- Policy alignment: 98% ⚠️ (target: 100%)
- Follow-up rate: 12% 📈 (target: 8%, so worsening)

**Action:**
```bash
# Trigger optimization focused on reducing follow-ups
skill activate: automatic-stateful-prompt-improver

request: "The refund chatbot is getting more follow-up questions.
          Optimize the prompt to reduce ambiguity and improve clarity."

# Skill action:
1. Retrieves 500 interactions + outcomes
2. Analyzes failures: which scenarios caused follow-ups?
3. Generates variants focusing on clarity
4. Tests against problematic scenarios
5. Returns improved prompt with +15% clarity score
```

---

## Part 4: Feedback Recording Integration

### Minimal Integration (Easy Start)

In your `src/refund-chatbot.ts`, add feedback logging:

```typescript
async function recordFeedbackExample() {
  const chatbot = new RefundChatbot(process.env.OPENAI_API_KEY!);
  
  // 1. Get response
  const response = await chatbot.processQuery("Can I return this?");
  
  // 2. Assess success (could be automated or manual)
  const userSatisfied = true; // From user rating
  const qualityScore = 0.92;  // From auto-evaluation
  
  // 3. Record for learning
  await recordFeedback({
    prompt_id: "refund-policy-v1.0",
    outcome: {
      success: userSatisfied,
      quality_score: qualityScore,
      latency_ms: 1200,
      output_tokens: 342
    },
    user_feedback: {
      satisfaction: 5,
      comments: "Very clear about the 30-day window"
    }
  });
}
```

### Full Integration (Production)

```typescript
// middleware/feedback-logger.ts
export async function logRefundChatbotFeedback(
  query: string,
  response: string,
  metrics: {
    latency_ms: number;
    tokens: number;
    userSatisfaction: 1 | 2 | 3 | 4 | 5;
    followUpQuestion?: string;
  }
) {
  // Auto-evaluate policy compliance
  const compliance = await chatbot.evaluatePolicyCompliance(query, response);
  
  // Record in vector DB
  await recordFeedback({
    prompt_id: "refund-policy-v1.0",
    domain: "refund_policy",
    outcome: {
      success: metrics.userSatisfaction >= 4,
      quality_score: compliance.score / 100,
      latency_ms: metrics.latency_ms,
      output_tokens: metrics.tokens
    },
    user_feedback: {
      satisfaction: metrics.userSatisfaction,
      comments: metrics.followUpQuestion
        ? `Follow-up needed: ${metrics.followUpQuestion}`
        : "Resolved in one message"
    }
  });
}
```

---

## Part 5: Retrieval-Based Improvement

### How RAG Helps the Chatbot

**Scenario:** User asks edge case: "I'm 45 days outside the return window but it's damaged in shipping..."

**Without Learning:**
- Bot uses generic system prompt
- Might give inconsistent answer
- No context from similar past cases

**With Learning (RAG):**
1. Query is embedded
2. Vector DB searched for similar past cases
3. Top 3 results retrieved:
   - "Shipping damage → full refund" (score: 0.95)
   - "Outside window → non-refundable" (score: 0.87)
   - "Damage assessment required" (score: 0.82)
4. Bot uses ensemble of these examples
5. Result: More consistent, informed answer

**Implementation:**
```typescript
// In chatbot handler
async function processWithRAG(userQuery: string) {
  const chatbot = new RefundChatbot(apiKey);
  
  // Get similar high-performing patterns
  const similar = await retrievePrompts({
    query: userQuery,
    domain: "refund_policy",
    top_k: 3,
    min_performance: 0.8
  });
  
  // Augment system prompt with retrieved examples
  const augmentedPrompt = buildAugmentedPrompt(
    SYSTEM_PROMPT,
    similar // High-performing past responses
  );
  
  // Use enhanced prompt
  const response = await callChatModel(augmentedPrompt, userQuery);
  
  // Record outcome for future learning
  recordFeedback(...);
}
```

---

## Part 6: Monitoring & Analytics

### Weekly Metrics Dashboard

```bash
# Call get_analytics every 7 days
analytics = get_analytics({
  domain: "refund_policy",
  time_range: "7d",
  metrics: [
    "success_rate",
    "token_efficiency",
    "avg_latency_ms"
  ]
})

# Expected output:
{
  "summary": {
    "total_prompts": 1,
    "avg_success_rate": 0.97,
    "improvement_trend": +0.15  # 15% improvement from last week
  },
  "by_domain": {
    "refund_policy": {
      "count": 487,
      "avg_success": 0.97
    }
  }
}
```

### Dashboards to Track

| Metric | Baseline | Week 1 | Week 2 | Week 3 | Target |
|--------|----------|--------|--------|--------|--------|
| Success Rate | 0.71 | 0.85 | 0.92 | 0.97 | 0.95+ |
| Avg Clarity Score | 0.62 | 0.78 | 0.88 | 0.95 | 0.95+ |
| Follow-up Rate | 28% | 18% | 12% | 8% | 8% |
| Edge Case Pass Rate | 40% | 62% | 75% | 88% | 90%+ |
| Avg Response Time | 1.8s | 1.6s | 1.5s | 1.4s | <2s |

---

## Part 7: Real-World Example

### Week 1: Deploy Initial Refund Prompt

**Action:**
```
"Deploy the refund chatbot prompt and record customer interactions"

Skill activates:
- Optimizes prompt once (initial cold-start)
- Sets up feedback recording
- Starts vector DB indexing
```

**Metrics After 100 interactions:**
- Success rate: 85%
- Clarity: 78%
- Follow-ups: 18%

### Week 2: Identify Problem Area

**Customer feedback reveals:** "You explained the 30-day window, but didn't mention what happens AFTER 30 days"

**Action:**
```
"The refund chatbot is missing end-of-window guidance. 
 Some customers don't understand they can get store credit instead."

Skill identifies:
- Problem: Incomplete answer to "What if outside window?"
- Retrieves similar: "Outside window → store credit option" (score: 0.91)
- Optimizes: Adds explicit guidance

Result: +8% clarity, -6% follow-ups
```

### Week 3: Edge Case Handling

**New edge case discovered:** Multiple returns in 3 months triggers fraud review

**Action:**
```
"Add fraud detection guidance to refund chatbot. 
 Customers need to know why their return is delayed after multiple returns."

Skill performs:
- Generates variants with explicit fraud-flag guidance
- Tests against 10 high-return-frequency customers
- Selects best variant
- Updates prompt

Result: 100% compliance on fraud-signal handling
```

### Week 4: Convergence

**All metrics hit targets:**
- Success rate: 97% ✅
- Clarity: 95% ✅
- Follow-ups: 8% ✅
- Edge cases: 88% ✅

**Maintenance mode:**
- Record feedback daily
- Monthly optimization review
- Quarterly full re-optimization

---

## Part 8: Integration Checklist

- [ ] MCP server running (`npm run setup`)
- [ ] OpenAI API key set (`OPENAI_API_KEY`)
- [ ] Skill enabled in Claude Code settings
- [ ] Initial system prompt deployed (from `refund-policy-prompt.md`)
- [ ] Test scenarios passing (88 tests in `refund-chatbot.test.ts`)
- [ ] Feedback logging integrated (optional: full vs minimal)
- [ ] Analytics dashboard created (weekly)
- [ ] Team trained on metrics interpretation
- [ ] Monthly optimization review scheduled
- [ ] Contingency plan if metrics regress

---

## Part 9: Troubleshooting

### Metrics Not Improving?

1. Check: Is feedback being recorded?
   ```bash
   curl http://localhost:6333/collections/prompt_metrics/points/count
   # Should see increasing point count
   ```

2. Check: Are similar prompts being retrieved?
   ```bash
   retrieve_prompts({
     query: "Can I return this?",
     min_performance: 0.7
   })
   # Should return 3-5 similar high-performing variants
   ```

3. Check: Is optimization converging?
   ```bash
   optimize_prompt({
     prompt: "Your current prompt",
     max_iterations: 15
   })
   # Should see improvement plateauing around iteration 10-12
   ```

### Vector DB Isn't Learning?

**Problem:** Metrics stuck at baseline week after week

**Solution:**
1. Verify feedback has `success` and `quality_score` fields
2. Ensure `quality_score` is 0.0-1.0 (not 0-100)
3. Check that prompt_id matches between feedback calls
4. Run `get_analytics` to see if data is aggregating

### Prompt Becoming Bloated?

**Problem:** After 3 iterations, prompt grew from 500 tokens to 2000 tokens

**Solution:**
1. Activate Occam's Razor check: "Simplify without losing performance"
2. Remove redundant constraints (e.g., if two constraints cover same scenario)
3. Consolidate examples (pick best 1 per scenario vs 2-3)
4. Re-optimize with feedback: "Keep clarity but reduce token count"

---

## Part 10: Advanced: Custom Evaluator

For maximum precision, use a domain-specific evaluator:

```typescript
async function evaluateRefundResponse(
  query: string,
  response: string
): Promise<{
  policyCompliant: boolean;
  clarityScore: number;
  edgeCaseHandled: boolean;
}> {
  // Domain-specific checks
  const checks = {
    mentions30days: response.includes('30'),
    statesCategoryFirst: /product|digital|service|final/.test(response),
    hasNextSteps: /next|return|order|label/.test(response),
    endsWithQuestion: response.trim().endsWith('?'),
    avoidsUncertainty: !/I think|probably|maybe|might/.test(response)
  };
  
  const score = Object.values(checks).filter(Boolean).length / 5;
  
  return {
    policyCompliant: checks.avoidsUncertainty,
    clarityScore: score,
    edgeCaseHandled: checks.statesCategoryFirst
  };
}
```

Then record with this evaluator:
```typescript
const evaluation = await evaluateRefundResponse(query, response);
recordFeedback({
  success: evaluation.policyCompliant && evaluation.clarityScore > 0.8,
  quality_score: evaluation.clarityScore
});
```

---

## Summary

| Phase | Duration | Goal | Method |
|-------|----------|------|--------|
| **Week 1** | Days 1-7 | Deploy & measure baseline | Initial optimization + feedback recording |
| **Week 2** | Days 8-14 | Identify weak spots | Analytics review + targeted optimization |
| **Week 3** | Days 15-21 | Fill gaps | Edge case optimization + augmentation |
| **Week 4** | Days 22-28 | Converge | Fine-tuning + contingency refinement |
| **Ongoing** | Monthly | Maintain & improve | Monthly re-optimization + RAG augmentation |

**Expected Result:** From 62% consistency to 97% consistency, 28% follow-up rate to 8%, within 4 weeks using the automatic-stateful-prompt-improver skill.

