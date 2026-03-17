import { useState, useEffect, useRef } from 'react';

// ─── Design tokens ────────────────────────────────────────────────────────────
// Aesthetic: editorial warmth — cream parchment, deep rust, ink brown
// Feels like a well-loved teacher's planner, not a cold admin dashboard

const T = {
  bg:      '#f7f3ee',
  bg2:     '#efe9df',
  bg3:     '#e5ddd0',
  ink:     '#1c1008',
  ink2:    '#3d2b15',
  muted:   '#8c7355',
  dim:     '#b8a48a',
  rust:    '#c0440e',
  rustDim: '#fce8df',
  gold:    '#c88b1a',
  goldDim: '#fdf3d8',
  teal:    '#1a7a6b',
  tealDim: '#d4f0eb',
  border:  '#d4c4af',
  border2: '#c2ae94',
  white:   '#fdfaf6',
};

// ─── Sample data ──────────────────────────────────────────────────────────────
const CLASS = {
  name: 'Grade 7A',
  subject: 'Mathematics',
  stream: 'Morning Session',
  term: 'Term 1, 2026',
  teacher: 'Mrs. Njoroge',
  room: 'Lab B-04',
};

const STUDENTS = [
  { id:1,  name:'Amara Osei',        adm:'ADM-0031', gender:'F', avgScore:88, attendance:96, competency:'EE' },
  { id:2,  name:'Brian Mutuku',       adm:'ADM-0032', gender:'M', avgScore:74, attendance:88, competency:'ME' },
  { id:3,  name:'Cynthia Wanjiru',    adm:'ADM-0033', gender:'F', avgScore:92, attendance:100, competency:'EE' },
  { id:4,  name:'Daniel Onyango',     adm:'ADM-0034', gender:'M', avgScore:61, attendance:79, competency:'AE' },
  { id:5,  name:'Esther Kamau',       adm:'ADM-0035', gender:'F', avgScore:83, attendance:93, competency:'ME' },
  { id:6,  name:'Fabian Njoroge',     adm:'ADM-0036', gender:'M', avgScore:55, attendance:72, competency:'AE' },
  { id:7,  name:'Grace Akinyi',       adm:'ADM-0037', gender:'F', avgScore:79, attendance:91, competency:'ME' },
  { id:8,  name:'Hassan Abdi',        adm:'ADM-0038', gender:'M', avgScore:68, attendance:84, competency:'ME' },
  { id:9,  name:'Irene Muthoni',      adm:'ADM-0039', gender:'F', avgScore:95, attendance:99, competency:'EE' },
  { id:10, name:'James Kariuki',      adm:'ADM-0040', gender:'M', avgScore:71, attendance:87, competency:'ME' },
  { id:11, name:'Kezia Njeri',        adm:'ADM-0041', gender:'F', avgScore:58, attendance:76, competency:'AE' },
  { id:12, name:'Laban Otieno',       adm:'ADM-0042', gender:'M', avgScore:82, attendance:94, competency:'ME' },
];

const TODAY = ['P','P','A','P','P','A','P','P','P','P','L','P']; // P=present A=absent L=late

const ASSESSMENTS = [
  { id:1, title:'Algebra: Equations Intro',    date:'Feb 7',  max:40, scores:[36,28,38,22,33,19,30,25,40,27,21,31], status:'graded' },
  { id:2, title:'Fractions & Percentages',     date:'Feb 14', max:50, scores:[44,37,48,28,40,24,38,32,50,34,27,39], status:'graded' },
  { id:3, title:'Mid-Term Assessment',         date:'Feb 21', max:100,scores:[88,74,92,61,83,55,79,68,95,71,58,82], status:'graded' },
  { id:4, title:'Geometry: Angles & Triangles',date:'Mar 3',  max:40, scores:null, status:'upcoming' },
];

const LESSONS = [
  { time:'8:00', subject:'Mathematics',  class:'7A', topic:'Quadratic Equations',    status:'now' },
  { time:'9:40', subject:'Mathematics',  class:'7B', topic:'Simultaneous Equations', status:'next' },
  { time:'11:20',subject:'Mathematics',  class:'8A', topic:'Logarithms',             status:'later' },
  { time:'2:00', subject:'Mathematics',  class:'7C', topic:'Statistics: Mean & Mode',status:'later' },
];

// ─── Tiny components ──────────────────────────────────────────────────────────

const cc = (score: number) => score >= 80 ? T.teal : score >= 60 ? T.gold : T.rust;

function Badge({ level }: { level: string }) {
  const map = {
    EE: { bg: T.tealDim, text: T.teal },
    ME: { bg: '#e8f0fe', text: '#1a4fbf' },
    AE: { bg: T.goldDim, text: T.gold },
    BE: { bg: T.rustDim, text: T.rust },
  };
  const c = map[level as keyof typeof map] || map.ME;
  return (
    <span style={{ background: c.bg, color: c.text, borderRadius: 4, padding: '2px 7px',
      fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono',monospace", letterSpacing: '0.04em' }}>
      {level}
    </span>
  );
}

function MiniBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  return (
    <div style={{ width: 60, height: 5, background: T.bg3, borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ width: `${(value / max) * 100}%`, height: '100%', background: color, borderRadius: 3 }} />
    </div>
  );
}

function AttTag({ status }: { status: string }) {
  const map = { P: { bg: T.tealDim, color: T.teal, label: 'P' }, A: { bg: T.rustDim, color: T.rust, label: 'A' }, L: { bg: T.goldDim, color: T.gold, label: 'L' } };
  const c = map[status as keyof typeof map] || map.P;
  return (
    <div style={{ width: 28, height: 28, borderRadius: 6, background: c.bg, display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12,
      color: c.color, fontFamily: "'DM Mono',monospace", cursor: 'pointer', flexShrink: 0 }}>
      {c.label}
    </div>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

function TodayTab() {
  const [view, setView] = useState('timetable');
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-KE', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Date strip */}
      <div style={{ background:T.ink, borderRadius:12, padding:'14px 18px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <div style={{ color:'#fff', fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:16 }}>{dateStr}</div>
          <div style={{ color:T.dim, fontSize:11, marginTop:2 }}>4 lessons today · {CLASS.teacher}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ color:T.rust, fontWeight:800, fontSize:13, fontFamily:"'DM Mono',monospace" }}>TERM 1</div>
          <div style={{ color:T.muted, fontSize:10 }}>Week 7 of 13</div>
        </div>
      </div>

      {/* Timetable */}
      <div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:14, color:T.ink2, marginBottom:10 }}>Today's Schedule</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {LESSONS.map((l, i) => (
            <div key={i} style={{ background: l.status==='now' ? T.ink : T.white,
              border:`1px solid ${l.status==='now' ? T.ink : T.border}`,
              borderRadius:12, padding:'12px 16px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ textAlign:'center', minWidth:44 }}>
                <div style={{ fontFamily:"'DM Mono',monospace", fontWeight:700, fontSize:13,
                  color: l.status==='now' ? T.rust : T.muted }}>{l.time}</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:13, color: l.status==='now' ? '#fff' : T.ink }}>{l.topic}</div>
                <div style={{ fontSize:11, color: l.status==='now' ? T.dim : T.muted, marginTop:2 }}>{l.class} · {l.subject}</div>
              </div>
              <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20,
                background: l.status==='now' ? T.rust : l.status==='next' ? T.goldDim : T.bg2,
                color: l.status==='now' ? '#fff' : l.status==='next' ? T.gold : T.dim }}>
                {l.status === 'now' ? 'NOW' : l.status === 'next' ? 'NEXT' : l.time}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:14, color:T.ink2, marginBottom:10 }}>Quick Actions</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { icon:'📋', label:'Mark Attendance', sub:'Grade 7A now in session' },
            { icon:'📝', label:'New Assessment', sub:'Create for any class' },
            { icon:'📊', label:'Class Report', sub:'Export term summary' },
            { icon:'🔄', label:'Sync Queue', sub:'2 conflicts pending' },
          ].map((a, i) => (
            <div key={i} style={{ background:T.white, border:`1px solid ${T.border}`, borderRadius:12,
              padding:'14px 14px', cursor:'pointer' }}>
              <div style={{ fontSize:22, marginBottom:6 }}>{a.icon}</div>
              <div style={{ fontWeight:700, fontSize:13, color:T.ink }}>{a.label}</div>
              <div style={{ fontSize:11, color:T.muted, marginTop:3 }}>{a.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AttendanceTab() {
  const [statuses, setStatuses] = useState([...TODAY]);
  const [saved, setSaved] = useState(false);
  const [saveAnim, setSaveAnim] = useState(false);
  const present = statuses.filter(s=>s==='P').length;
  const absent  = statuses.filter(s=>s==='A').length;
  const late    = statuses.filter(s=>s==='L').length;

  const cycle = (i: number) => {
    const order = ['P', 'A', 'L'];
    const next = order[(order.indexOf(statuses[i]) + 1) % 3];
    const updated = [...statuses];
    updated[i] = next;
    setStatuses(updated);
    setSaved(false);
  };

  const markAll = (s: string) => { setStatuses(STUDENTS.map(() => s)); setSaved(false); };

  const save = () => {
    setSaveAnim(true);
    setTimeout(() => { setSaveAnim(false); setSaved(true); }, 800);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:16, color:T.ink }}>{CLASS.name} · Register</div>
          <div style={{ fontSize:11, color:T.muted }}>Friday, 21 February 2026 · Period 1</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {[['All Present','P',T.teal],['All Absent','A',T.rust]].map(([lbl,s,col]) => (
            <button key={s} onClick={()=>markAll(s)}
              style={{ background:T.bg2, border:`1px solid ${T.border}`, color:T.muted,
                borderRadius:8, padding:'6px 10px', fontSize:11, cursor:'pointer', fontWeight:600 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:16 }}>
        {[
          { label:'Present', count:present, color:T.teal, bg:T.tealDim },
          { label:'Absent',  count:absent,  color:T.rust, bg:T.rustDim },
          { label:'Late',    count:late,    color:T.gold, bg:T.goldDim },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:24, color:s.color }}>{s.count}</div>
            <div style={{ fontSize:10, color:s.color, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:12, marginBottom:12, fontSize:11, color:T.muted }}>
        <span>Tap to cycle:</span>
        {[['P','Present',T.teal],['A','Absent',T.rust],['L','Late',T.gold]].map(([s,l,c]) => (
          <span key={s} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ background:`${c}22`, color:c, borderRadius:3, padding:'1px 6px', fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{s}</span>
            {l}
          </span>
        ))}
      </div>

      {/* Student list */}
      <div style={{ background:T.white, border:`1px solid ${T.border}`, borderRadius:14, overflow:'hidden', marginBottom:16 }}>
        {STUDENTS.map((s, i) => (
          <div key={s.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px',
            borderBottom: i < STUDENTS.length-1 ? `1px solid ${T.bg3}` : 'none',
            background: i%2===0 ? T.white : T.bg }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:T.dim, minWidth:22, textAlign:'right' }}>{i+1}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:13, color:T.ink }}>{s.name}</div>
              <div style={{ fontSize:10, color:T.muted }}>{s.adm}</div>
            </div>
            <div onClick={()=>cycle(i)} style={{ cursor:'pointer' }}>
              <AttTag status={statuses[i]} />
            </div>
          </div>
        ))}
      </div>

      {/* Save */}
      <button onClick={save}
        style={{ width:'100%', background: saved ? T.teal : T.ink, color:'#fff', border:'none',
          borderRadius:12, padding:14, fontFamily:"'Playfair Display',serif", fontWeight:700,
          fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
          transition:'background 0.3s' }}>
        {saveAnim ? '💾 Saving...' : saved ? '✅ Attendance Saved' : '💾 Save Register'}
      </button>
    </div>
  );
}

function AssessmentsTab() {
  const [active, setActive] = useState<number | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMax, setNewMax] = useState('40');
  const [newDate, setNewDate] = useState('');

  const avg = (scores: number[] | null) => scores ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const pct = (scores: number[] | null, max: number) => scores ? Math.round((avg(scores)! / max) * 100) : null;

  if (active) {
    const a = ASSESSMENTS.find(x => x.id === active);
    if (!a) return null;
    const scores = a.scores || STUDENTS.map(()=>0);
    return (
      <div>
        <button onClick={()=>setActive(null)}
          style={{ background:'transparent', border:'none', color:T.muted, cursor:'pointer',
            fontSize:12, fontWeight:600, marginBottom:16, display:'flex', alignItems:'center', gap:4 }}>
          ← Back
        </button>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:17, color:T.ink }}>{a.title}</div>
          <div style={{ fontSize:12, color:T.muted }}>{a.date} · Max: {a.max} marks</div>
        </div>

        {/* Class stats */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:16 }}>
          {[
            { label:'Class Avg', val:`${pct(a.scores, a.max)}%`, color:T.teal },
            { label:'Highest', val: a.scores ? `${Math.max(...a.scores)}/${a.max}` : '—', color:T.gold },
            { label:'Below 50%', val: a.scores ? a.scores.filter(s=>s/a.max<0.5).length : '—', color:T.rust },
          ].map(s => (
            <div key={s.label} style={{ background:T.white, border:`1px solid ${T.border}`, borderRadius:10, padding:'12px', textAlign:'center' }}>
              <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:20, color:s.color }}>{s.val}</div>
              <div style={{ fontSize:10, color:T.muted, marginTop:2, textTransform:'uppercase', letterSpacing:'0.07em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Score list */}
        <div style={{ background:T.white, border:`1px solid ${T.border}`, borderRadius:14, overflow:'hidden' }}>
          {STUDENTS.map((s, i) => {
            const score = a.scores ? a.scores[i] : null;
            const p = score !== null ? Math.round((score/a.max)*100) : null;
            return (
              <div key={s.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px',
                borderBottom: i < STUDENTS.length-1 ? `1px solid ${T.bg3}` : 'none' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:T.ink }}>{s.name}</div>
                </div>
                {score !== null ? (
                  <>
                    <MiniBar value={score} max={a.max} color={cc(p || 0)} />
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700,
                      color: cc(p || 0), minWidth: 44, textAlign: 'right' }}>{score}/{a.max}</div>
                    <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: T.muted,
                      minWidth: 34, textAlign: 'right' }}>{p}%</div>
                  </>
                ) : (
                  <div style={{ fontSize:11, color:T.dim, fontStyle:'italic' }}>Not graded</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (newMode) {
    return (
      <div>
        <button onClick={()=>setNewMode(false)}
          style={{ background:'transparent', border:'none', color:T.muted, cursor:'pointer',
            fontSize:12, fontWeight:600, marginBottom:16, display:'flex', alignItems:'center', gap:4 }}>
          ← Cancel
        </button>
        <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:17, color:T.ink, marginBottom:20 }}>New Assessment</div>
        {[
          { label:'Title', el: <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="e.g. End of Term Test"
            style={{ width:'100%', background:T.white, border:`1px solid ${T.border}`, borderRadius:10, padding:'11px 13px', color:T.ink, fontSize:14, outline:'none', boxSizing:'border-box' }} /> },
          { label:'Maximum Marks', el: <input value={newMax} onChange={e=>setNewMax(e.target.value)} type="number"
            style={{ width:'100%', background:T.white, border:`1px solid ${T.border}`, borderRadius:10, padding:'11px 13px', color:T.ink, fontSize:14, outline:'none', boxSizing:'border-box' }} /> },
          { label:'Date', el: <input value={newDate} onChange={e=>setNewDate(e.target.value)} type="date"
            style={{ width:'100%', background:T.white, border:`1px solid ${T.border}`, borderRadius:10, padding:'11px 13px', color:T.ink, fontSize:14, outline:'none', boxSizing:'border-box' }} /> },
        ].map(f => (
          <div key={f.label} style={{ marginBottom:16 }}>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:7 }}>{f.label}</label>
            {f.el}
          </div>
        ))}
        <div style={{ marginBottom:16 }}>
          <label style={{ display:'block', fontSize:11, fontWeight:700, color:T.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:7 }}>Classes</label>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {['7A','7B','7C','8A','8B'].map(c => (
              <div key={c} style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:8, padding:'6px 14px', fontSize:12, color:T.ink2, cursor:'pointer' }}>{c}</div>
            ))}
          </div>
        </div>
        <button onClick={()=>setNewMode(false)}
          style={{ width:'100%', background:T.ink, color:'#fff', border:'none', borderRadius:12,
            padding:14, fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:15, cursor:'pointer' }}>
          Create Assessment
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:16, color:T.ink }}>{CLASS.name} · Assessments</div>
        <button onClick={()=>setNewMode(true)}
          style={{ background:T.ink, color:'#fff', border:'none', borderRadius:9, padding:'8px 14px',
            fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
          + New
        </button>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        {ASSESSMENTS.map(a => {
          const p = pct(a.scores, a.max);
          return (
            <div key={a.id} onClick={()=>setActive(a.id)} style={{ background:T.white, border:`1px solid ${T.border}`,
              borderRadius:12, padding:'14px 16px', cursor:'pointer' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:a.scores?10:0 }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:13, color:T.ink, marginBottom:3 }}>{a.title}</div>
                  <div style={{ fontSize:11, color:T.muted }}>{a.date} · {a.max} marks</div>
                </div>
                <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20,
                  background: a.status==='graded' ? T.tealDim : T.goldDim,
                  color: a.status==='graded' ? T.teal : T.gold }}>
                  {a.status === 'graded' ? 'GRADED' : 'UPCOMING'}
                </span>
              </div>
              {a.scores && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 5, background: T.bg3, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${p || 0}%`, height: '100%', background: cc(p || 0), borderRadius: 3 }} />
                  </div>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, color: cc(p || 0), minWidth: 36, textAlign: 'right' }}>{p}%</span>
                  <span style={{ fontSize: 11, color: T.muted }}>avg</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClassbookTab() {
  const [sortBy, setSortBy] = useState('name');
  const [selected, setSelected] = useState<number | null>(null);

  const sorted = [...STUDENTS].sort((a, b) => {
    if (sortBy === 'score') return b.avgScore - a.avgScore;
    if (sortBy === 'attendance') return b.attendance - a.attendance;
    return a.name.localeCompare(b.name);
  });

  if (selected) {
    const s = STUDENTS.find(x => x.id === selected);
    if (!s) return null;
    const attHistory = Array.from({ length:14 }, (_,i) => ({
      day: i+1, status: Math.random()>0.12 ? 'P' : Math.random()>0.5 ? 'L' : 'A',
    }));
    return (
      <div>
        <button onClick={()=>setSelected(null)}
          style={{ background:'transparent', border:'none', color:T.muted, cursor:'pointer',
            fontSize:12, fontWeight:600, marginBottom:16, display:'flex', alignItems:'center', gap:4 }}>
          ← Back to class
        </button>
        {/* Student header */}
        <div style={{ background:T.ink, borderRadius:14, padding:'18px 18px', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14 }}>
            <div style={{ width:48, height:48, borderRadius:24, background:T.rust, display:'flex',
              alignItems:'center', justifyContent:'center', fontSize:22 }}>
              {s.gender==='F'?'👩':'👨'}
            </div>
            <div>
              <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:17, color:'#fff' }}>{s.name}</div>
              <div style={{ fontSize:11, color:T.dim }}>{s.adm} · Grade 7A</div>
            </div>
            <div style={{ marginLeft:'auto' }}>
              <Badge level={s.competency} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
            {[
              { label:'Avg Score', val:`${s.avgScore}%`, color:cc(s.avgScore) },
              { label:'Attendance', val:`${s.attendance}%`, color: s.attendance>=90?T.teal:s.attendance>=75?T.gold:T.rust },
              { label:'Level', val:s.competency, color:T.rust },
            ].map(m => (
              <div key={m.label} style={{ background:'rgba(255,255,255,0.06)', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
                <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:18, color:m.color }}>{m.val}</div>
                <div style={{ fontSize:9, color:T.dim, textTransform:'uppercase', letterSpacing:'0.08em', marginTop:2 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Assessment history */}
        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 14, color: T.ink2, marginBottom: 10 }}>Assessment History</div>
        <div style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          {ASSESSMENTS.filter(a => a.scores).map((a, i) => {
            const idx = STUDENTS.findIndex(x => x.id === selected);
            const score = (a.scores as number[])[idx];
            const p = Math.round((score / a.max) * 100);
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                borderBottom: i < 2 ? `1px solid ${T.bg3}` : undefined }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.ink }}>{a.title}</div>
                  <div style={{ fontSize:10, color:T.muted }}>{a.date}</div>
                </div>
                <MiniBar value={score} max={a.max} color={cc(p)} />
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color:cc(p), minWidth:40, textAlign:'right' }}>{p}%</span>
              </div>
            );
          })}
        </div>

        {/* Attendance grid */}
        <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:14, color:T.ink2, marginBottom:10 }}>Attendance This Term</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {attHistory.map((d,i) => (
            <AttTag key={i} status={d.status} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:16, color:T.ink }}>{CLASS.name} · {STUDENTS.length} students</div>
        <div style={{ display:'flex', gap:6 }}>
          {[['name','A–Z'],['score','Score'],['attendance','Att.']].map(([k,l]) => (
            <button key={k} onClick={()=>setSortBy(k)}
              style={{ background: sortBy===k ? T.ink : T.bg2, border:`1px solid ${sortBy===k?T.ink:T.border}`,
                color: sortBy===k ? '#fff' : T.muted, borderRadius:7, padding:'5px 10px',
                fontSize:11, cursor:'pointer', fontWeight:600 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Summary row */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:6, marginBottom:16 }}>
        {[
          { label:'EE', count:STUDENTS.filter(s=>s.competency==='EE').length, color:T.teal },
          { label:'ME', count:STUDENTS.filter(s=>s.competency==='ME').length, color:'#1a4fbf' },
          { label:'AE', count:STUDENTS.filter(s=>s.competency==='AE').length, color:T.gold },
          { label:'Avg', count:Math.round(STUDENTS.reduce((a,s)=>a+s.avgScore,0)/STUDENTS.length)+'%', color:T.rust },
        ].map(s => (
          <div key={s.label} style={{ background:T.white, border:`1px solid ${T.border}`, borderRadius:9, padding:'10px 8px', textAlign:'center' }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:18, color:s.color }}>{s.count}</div>
            <div style={{ fontSize:9, color:T.muted, textTransform:'uppercase', letterSpacing:'0.07em' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Student list */}
      <div style={{ background:T.white, border:`1px solid ${T.border}`, borderRadius:14, overflow:'hidden' }}>
        {sorted.map((s, i) => (
          <div key={s.id} onClick={()=>setSelected(s.id)}
            style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px', cursor:'pointer',
              borderBottom: i<sorted.length-1?`1px solid ${T.bg3}`:undefined,
              background: i%2===0 ? T.white : T.bg }}>
            <div style={{ width:32, height:32, borderRadius:10, background:T.bg3,
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
              {s.gender==='F'?'👩':'👨'}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, fontSize:13, color:T.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
              <div style={{ fontSize:10, color:T.muted }}>{s.adm}</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <MiniBar value={s.avgScore} color={cc(s.avgScore)} />
              <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:cc(s.avgScore), minWidth:30, textAlign:'right', fontWeight:700 }}>{s.avgScore}%</span>
              <Badge level={s.competency} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LessonPlanTab() {
  interface LessonPlan {
    topic: string;
    strand: string;
    objective: string;
    materials: string;
    intro: string;
    main: string;
    plenary: string;
    homework: string;
    duration: string;
  }

  const [plan, setPlan] = useState<LessonPlan>({
    topic: 'Quadratic Equations — Factorisation Method',
    strand: 'Critical Thinking & Problem Solving',
    objective: 'Learners will solve quadratic equations by factorisation',
    materials: 'Textbook pp.142-148, whiteboard, coloured chalk',
    intro: 'Review linear equations (5 min). Pose the challenge: can we solve x² + 5x + 6 = 0?',
    main: 'Demonstrate factorisation. Guided practice in pairs. Independent work: 3 problems.',
    plenary: 'Exit ticket: 2 equations to factorise independently.',
    homework: 'Exercise 8B: Questions 1-8',
    duration: '80',
  });

  return (
    <div>
      <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 16, color: T.ink, marginBottom: 4 }}>Lesson Plan</div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 18 }}>{CLASS.name} · {CLASS.subject} · Period 1, Today</div>

      {[
        { label: 'Topic / Title', key: 'topic' as keyof LessonPlan, multiline: false },
        { label: 'CBC Strand', key: 'strand' as keyof LessonPlan, multiline: false },
        { label: 'Learning Objective', key: 'objective' as keyof LessonPlan, multiline: false },
        { label: 'Materials & Resources', key: 'materials' as keyof LessonPlan, multiline: false },
        { label: 'Introduction (Hook)', key: 'intro' as keyof LessonPlan, multiline: true },
        { label: 'Main Activities', key: 'main' as keyof LessonPlan, multiline: true },
        { label: 'Plenary / Closure', key: 'plenary' as keyof LessonPlan, multiline: true },
        { label: 'Homework / Follow-up', key: 'homework' as keyof LessonPlan, multiline: false },
      ].map(f => (
        <div key={f.key} style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: T.muted,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{f.label}</label>
          {f.multiline ? (
            <textarea value={plan[f.key]} onChange={e => setPlan({ ...plan, [f.key]: e.target.value })} rows={3}
              style={{ width: '100%', background: T.white, border: `1px solid ${T.border}`, borderRadius: 10,
                padding: '10px 13px', color: T.ink, fontSize: 13, outline: 'none', resize: 'vertical',
                boxSizing: 'border-box', fontFamily: "'DM Mono',monospace", lineHeight: 1.6 }} />
          ) : (
            <input value={plan[f.key]} onChange={e => setPlan({ ...plan, [f.key]: e.target.value })}
              style={{ width: '100%', background: T.white, border: `1px solid ${T.border}`, borderRadius: 10,
                padding: '10px 13px', color: T.ink, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          )}
        </div>
      ))}
      <div style={{ marginBottom:14 }}>
        <label style={{ display:'block', fontSize:11, fontWeight:700, color:T.muted,
          textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Duration (minutes)</label>
        <div style={{ display:'flex', gap:8 }}>
          {['40','80','120'].map(d => (
            <button key={d} onClick={()=>setPlan({ ...plan,duration:d })}
              style={{ background: plan.duration===d ? T.ink : T.bg2, border:`1px solid ${plan.duration===d?T.ink:T.border}`,
                color: plan.duration===d ? '#fff' : T.muted, borderRadius:8, padding:'8px 16px',
                fontSize:12, fontWeight:700, cursor:'pointer' }}>
              {d} min
            </button>
          ))}
        </div>
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <button style={{ flex:1, background:T.ink, color:'#fff', border:'none', borderRadius:12, padding:13,
          fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:14, cursor:'pointer' }}>
          💾 Save Plan
        </button>
        <button style={{ background:T.bg2, color:T.muted, border:`1px solid ${T.border}`, borderRadius:12,
          padding:'13px 18px', fontSize:13, cursor:'pointer' }}>
          🖨 Print
        </button>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const TABS = [
  { id:'today',      label:'Today',      icon:'☀️' },
  { id:'attendance', label:'Attendance', icon:'📋' },
  { id:'assess',     label:'Assessments',icon:'📝' },
  { id:'classbook',  label:'Classbook',  icon:'👥' },
  { id:'plan',       label:'Lesson Plan',icon:'📖' },
];

export default function TeacherPortal() {
  const [tab, setTab] = useState('today');

  return (
    <div style={{ height:'100%', background:T.bg, fontFamily:"'DM Sans',sans-serif", display:'flex', flexDirection:'column', overflowY:'hidden' }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background:T.white, borderBottom:`1px solid ${T.border}`, padding:'14px 18px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
          <div style={{ width:42, height:42, borderRadius:14, background:T.ink, display:'flex',
            alignItems:'center', justifyContent:'center', fontSize:20 }}>📚</div>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Playfair Display',serif", fontWeight:700, fontSize:15, color:T.ink }}>
              {CLASS.teacher}
            </div>
            <div style={{ fontSize:11, color:T.muted }}>{CLASS.subject} · {CLASS.name} · {CLASS.room}</div>
          </div>
          <div style={{ background:T.rustDim, borderRadius:8, padding:'6px 12px', textAlign:'center' }}>
            <div style={{ fontFamily:"'DM Mono',monospace", fontWeight:700, fontSize:11, color:T.rust }}>OFFLINE</div>
            <div style={{ fontSize:9, color:T.rust, opacity:0.7 }}>2 conflicts</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:0, overflowX:'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ background:'transparent', border:'none',
                borderBottom: tab===t.id ? `2px solid ${T.rust}` : '2px solid transparent',
                color: tab===t.id ? T.rust : T.muted,
                padding:'7px 12px', fontSize:11, fontWeight:700, cursor:'pointer',
                whiteSpace:'nowrap', flexShrink:0, transition:'all 0.15s' }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'18px 18px 32px' }}>
        {tab === 'today'      && <TodayTab />}
        {tab === 'attendance' && <AttendanceTab />}
        {tab === 'assess'     && <AssessmentsTab />}
        {tab === 'classbook'  && <ClassbookTab />}
        {tab === 'plan'       && <LessonPlanTab />}
      </div>
    </div>
  );
}
