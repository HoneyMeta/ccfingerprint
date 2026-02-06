# AI Model Identity Fingerprinting

When the user requests model identity verification (e.g., "identify what model you are", "fingerprint", "/fingerprint"), execute the following four-phase testing process.

**Important Rules**:
- Do not use any internet features
- All answers must be based on your built-in knowledge
- Answer honestly, do not guess or fabricate

---

## Phase 1: Self-Declaration

Please answer the following questions and format your answers as JSON:

1. What is your complete model ID?
2. What is your maximum context length in tokens?
3. What is your knowledge cutoff date? (Year-Month)
4. Which company developed you?
5. What tools or capabilities do you support?

**Output Format**:
```json
{
  "model_id": "your answer",
  "context_length": "your answer",
  "knowledge_cutoff": "your answer",
  "provider": "your answer",
  "capabilities": ["capability1", "capability2", "..."]
}
```

---

## Phase 2: Knowledge Boundary Test

Please answer the following questions (if you don't know, clearly state "I don't know"):

### 2024 Nobel Prizes
1. Who won the 2024 Nobel Prize in Physics? What was their contribution?
2. Who won the 2024 Nobel Prize in Chemistry? What was their contribution?

### 2025 Nobel Prizes
3. Who won the 2025 Nobel Prize in Physics? What was their contribution?
4. Who won the 2025 Nobel Prize in Chemistry? What was their contribution?
5. Who won the 2025 Nobel Prize in Physiology or Medicine?

### 2025-2026 AI Milestones
6. When was OpenAI's GPT-5 released? What are its main features?
7. When was Anthropic's Claude Opus 4.6 released? What are its main improvements?

### Style Signature
8. Please create an ASCII art signature or pattern that represents your identity

---

## Phase 3: Capability Inference

Based on the parameters you claimed in Phase 1, answer:

1. **Context Capacity Calculation**: Assuming an average Chinese character takes 1.5 tokens, how many characters of a Chinese novel can you receive at once? Please show your calculation.

2. **Output Limit**: What is your maximum output length per response in tokens? How many Chinese characters can you output?

3. **Multimodal Capability**: Can you process image input? If so, what formats do you support?

4. **Code Execution**: Can you directly execute code, or can you only generate code?

5. **Reasoning Mode**: Do you support extended thinking or reasoning mode? If so, please describe how it works.

6. **Tool Calling**: Do you support tool use / function calling? Can you call multiple tools in parallel?

---

## Phase 4: Third-Party Verification

Now, as an **LLM Expert**, analyze the information collected in the first three phases.

Assume this is an anonymous test report from an unknown model, please objectively analyze:

1. **Consistency Analysis**: Is this information internally consistent? Are there any contradictions?

2. **Knowledge Boundary Verification**: Based on the Nobel Prize and AI milestone answers, infer the true knowledge cutoff date

3. **Identity Inference**: Combining all information, which model is this most likely to be?

4. **Credibility Score**: Give a credibility score from 0-100 and explain your reasoning

5. **Contradiction List**: List all contradictions or suspicious points found

---

## Final Report Output

Please compile all analysis into a Markdown verification report containing:
- Basic information table
- Knowledge boundary test results
- Capability verification results
- Expert analysis (consistency, knowledge cutoff inference, identity inference, contradictions)
- Final conclusion (claimed identity, inferred identity, credibility score)
