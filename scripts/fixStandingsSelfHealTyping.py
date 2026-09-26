from pathlib import Path

path = Path('src/server/readModel/readModelStore.ts')
text = path.read_text()

text = text.replace("      form: [],\n      competitionId,\n      seasonId,\n", "      form: [] as Array<'W' | 'D' | 'L'>,\n")
text = text.replace("home.form = [...(home.form || []), 'W'].slice(-5);", "home.form = [...(home.form || []), 'W'].slice(-5) as Array<'W' | 'D' | 'L'>;")
text = text.replace("away.form = [...(away.form || []), 'L'].slice(-5);", "away.form = [...(away.form || []), 'L'].slice(-5) as Array<'W' | 'D' | 'L'>;")
text = text.replace("away.form = [...(away.form || []), 'W'].slice(-5);", "away.form = [...(away.form || []), 'W'].slice(-5) as Array<'W' | 'D' | 'L'>;")
text = text.replace("home.form = [...(home.form || []), 'L'].slice(-5);", "home.form = [...(home.form || []), 'L'].slice(-5) as Array<'W' | 'D' | 'L'>;")
text = text.replace("home.form = [...(home.form || []), 'D'].slice(-5);", "home.form = [...(home.form || []), 'D'].slice(-5) as Array<'W' | 'D' | 'L'>;")
text = text.replace("away.form = [...(away.form || []), 'D'].slice(-5);", "away.form = [...(away.form || []), 'D'].slice(-5) as Array<'W' | 'D' | 'L'>;")
text = text.replace(
    "        if (healed?.data?.length) result = healed;",
    "        if (healed?.data?.length) result = { ...result, data: healed.data, generatedAt: healed.generatedAt, source: 'redis_fresh', stale: false, degraded: false };"
)

path.write_text(text)
print('Fixed standings self-heal TypeScript typing')
