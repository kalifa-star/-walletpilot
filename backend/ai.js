// Optional proposal review only. This module has no execution or wallet API.
export async function reviewEntry(observation, { fetcher = fetch, key = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL } = {}) {
  if (!key || !model) throw new Error('AI review requires server-side OPENAI_API_KEY and OPENAI_MODEL.');
  let response;
  try {
    response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type':'application/json', Authorization:`Bearer ${key}` },
      body: JSON.stringify({ model, store: false, max_output_tokens: 600,
        instructions: 'Review a proposed EUR/USD paper-trading entry using ONLY the supplied structured observations. Return allow or veto and a short reason grounded in supplied indicator values. Veto inconsistent or insufficient data. Do not predict guaranteed returns, invent news, access external data, or propose sizes, prices, credentials, or execution. You cannot change risk limits. This is an experimental reviewer, not evidence of a profitable strategy.',
        input: JSON.stringify(observation),
        text: { format: { type:'json_schema', name:'entry_review', strict:true, schema:{ type:'object', properties:{ verdict:{ type:'string',enum:['allow','veto'] }, reason:{ type:'string' } }, required:['verdict','reason'], additionalProperties:false } } },
      }),
    });
  } catch { throw new Error('AI reviewer unavailable. Proposed entry blocked.'); }
  if (!response.ok) throw new Error(`AI reviewer returned HTTP ${response.status}. Proposed entry blocked.`);
  const result = await response.json();
  if (result.status !== 'completed') throw new Error('AI review did not complete. Proposed entry blocked.');
  const content = (result.output || []).flatMap(item=>item.content || []);
  if (content.some(item=>item.type==='refusal')) throw new Error('AI reviewer refused the request. Proposed entry blocked.');
  let review;
  try { review=JSON.parse(content.filter(item=>item.type==='output_text').map(item=>item.text).join('')); }
  catch { throw new Error('Invalid AI output. Proposed entry blocked.'); }
  if (!review || Object.keys(review).sort().join(',') !== 'reason,verdict' || !['allow','veto'].includes(review.verdict) || typeof review.reason !== 'string' || !review.reason.trim() || review.reason.length>1200) throw new Error('Invalid AI review schema. Proposed entry blocked.');
  return { ...review, model };
}
