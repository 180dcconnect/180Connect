**180Connect**

**LLM Provider Research**

# 1\. LLM Usage & Requirements

180Connect needs an LLM for five jobs: 

1. generating outreach emails, 

2. summarising charities into Client Booklets, 

3. classifying incoming replies, 

4. turning plain-English search into database filters, and 

5. scoring charity priority if we go with the LLM-agent path for SCOUT instead of a trained model.

None of these need a custom-trained model. They're all things a general-purpose LLM API already does well, so this research is about which provider, and which model tier fits each job.

# 2\. The five tasks, side by side

| Task | What it needs | How often it runs |
| :---- | :---- | :---- |
| Reply classification | Fast, cheap, reliable, structured output (JSON) | Every incoming reply |
| NL charity search | Fast, cheap, reliable, structured output (JSON) | Every search a CAM runs |
| VOICE email drafts | Good tone, follows CAM settings and booklet context, no hallucinated charity details | Stage 1 and Stage 2, per charity |
| Client Booklet generation | Accurate summarisation from real data, moderate length | Once per charity, refreshed occasionally |
| SCOUT scoring (LLM-agent route only) | Deep reasoning, large context per organisation | Once per charity, low volume |

# 3\. Gemini models

| Model | Price ($/M tokens, in / out) | Context | Free tier | Best for |
| :---- | :---- | :---- | :---- | :---- |
| Gemini 3.5 Flash-Lite | $0.30 / $2.50 | 1M | Yes, rate-limited | Reply classification, NL search |
| Gemini 3.6 Flash | $1.50 / $7.50 | 1M | Yes, rate-limited | Email drafts, Client Booklets |
| Gemini 3.1 Pro | $2.00 / $12.00 | 2M | No, paid only | SCOUT agent scoring only |

# 4\. Claude models

| Model | Price ($/M tokens, in / out) | Context | Free tier | Best for |
| :---- | :---- | :---- | :---- | :---- |
| Claude Haiku 4.5 | $1 / $5 | 1M | No | Reply classification, NL search |
| Claude Sonnet 5 | $2 / $10 | 1M | No | Email drafts, Client Booklets |
| Claude Opus 4.8 | $5 / $25 | 1M | No | Not needed for our task list |

*Claude has no free tier at all, not even a limited one. Every API call costs money from the first token, including during testing.*

# 5\. How the pricing works

Both providers charge separately for input (what you send in) and output (what the model generates back), and output always costs more, usually 4 to 8 times the input rate. Generating each token takes a full pass through the model, while input can be processed in parallel and cached.

It is worth making sure, we keep a strict limit to the prompt input words and a output word limit to ensure we are not driving a bill a lot higher than what’s required.

# 6\. Recommendation

| Task | Primary model | Backup model ? |
| :---- | :---- | :---- |
| Reply classification / NL search | Gemini 3.5 Flash-Lite | Claude Haiku 4.5 |
| Email drafts / Client Booklets | Gemini 3.6 Flash | Claude Sonnet 5 |
| SCOUT scoring, if LLM-agent route | Gemini 3.1 Pro | Claude Opus 4.8 |

Gemini should be used as primary as it's cheaper across every tier, and the free tier means we can build and test the whole pipeline at zero cost before any real data is involved. Claude Sonnet 5 is a much better model across all factors but no free development and costs overall makes it a good backup if needed.

It is important to make sure we spend some time to make a abstraction layer which allows us to change models quickly , easily, as google seems to be retiring its old models quite frequently so is the case with other companies, so we cant just build everything for one-off use

# 7\. Openrouter.ai? optional connector

[OpenRouter](https://openrouter.ai/) and similar gateways let you call any provider through one API key, and they don't mark up token prices, just a 5.5% fee on credit top-ups. The following is the reason why its not the best choice for us : 

* We're only using two providers, Gemini and Claude, so we don’t need 100s of models.

* Adding another layer from a third party company.

* Vercel's own AI Gateway gives the same switching and fallback benefit natively, without adding a third party to the data path.

Recommended to use Vercel AI SDK gateway

# 8\. Vercel AI SDK and AI Gateway

**Two options to choose from :**

**AI SDK** is a free, open-source library. It gives one interface across providers, so switching models is a easy config change. No cost to use it straight off.

**AI Gateway** is Vercel's optional routing layer, built on top of the SDK. It adds one dashboard, one bill, and automatic fallback between providers. $5 a month in credits is included automatically, then it's pay-as-you-gone at the provider's exact list price, with no markup. 

Limits worth knowing: the free tier only covers a subset of models and has lower rate limits, fine for development, not something to rely on once we're live.

 Cons for using this setup:

1. Limited models available

2. Rate limits might be lower than using the models straight off.