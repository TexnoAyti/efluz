from pathlib import Path
p = Path('src/server/sync/mutationQueue.ts')
s = p.read_text()
old = "if (!existingSubDoc.exists) tx.create(subRef, incomingSubmission);"
new = "if (!existingSubDoc.exists) tx.set(subRef, incomingSubmission);"
if old not in s:
    raise SystemExit('tx.create marker missing')
p.write_text(s.replace(old, new, 1))
print('transaction submission write switched to tx.set after prior existence check')
