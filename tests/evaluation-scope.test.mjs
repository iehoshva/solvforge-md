import test from 'node:test'
import assert from 'node:assert/strict'
import {evaluated,withEvidenceEvaluation} from '../lib/workbench/evaluation-scope.ts'
test('validation reuse ends on every evaluation and exception; changed evidence is recalculated',()=>{
 const source={value:1};let calls=0;const read=()=>evaluated('test',source,()=>{calls++;return source.value})
 assert.equal(withEvidenceEvaluation(()=>read()+read()),2);assert.equal(calls,1)
 source.value=4;assert.equal(withEvidenceEvaluation(()=>read()+read()),8);assert.equal(calls,2)
 assert.throws(()=>withEvidenceEvaluation(()=>{read();throw Error('abort')}),/abort/)
 source.value=9;assert.equal(read(),9);assert.equal(calls,4)
})
