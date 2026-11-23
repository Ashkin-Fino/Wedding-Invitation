import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Gift, Heart, ImagePlus, MapPin, Menu, Music2, Pause, Send, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import { WEDDING, IMAGES, MUSIC_URL } from "./config";

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

const reveal = { hidden: { opacity: 0, y: 22 }, visible: { opacity: 1, y: 0, transition: { duration: .65, ease: [.22, 1, .36, 1] } } };
function Heading({ eyebrow, title, subtitle, light = false }) {
  return <motion.div className={`section-heading ${light ? "light" : ""}`} variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true, amount: .2 }}>
    <span className="eyebrow"><i />{eyebrow}<i /></span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}
  </motion.div>;
}
function Flourish() { 
  return <div className="flourish" aria-hidden="true"><span>✦</span><i /><span>❧</span><i /><span>✦</span></div>; 
}
function Countdown() {
  const target = new Date(WEDDING.dateISO).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const values = useMemo(() => { const d = Math.max(0, target - now); return [["Days", Math.floor(d / 86400000)], ["Hours", Math.floor(d / 3600000) % 24], ["Minutes", Math.floor(d / 60000) % 60], ["Seconds", Math.floor(d / 1000) % 60]]; }, [now, target]);
  return <div className="countdown-grid">{values.map(([label, value]) => <div className="countdown-cell" key={label}><strong>{String(value).padStart(2, "0")}</strong><span>{label}</span></div>)}</div>;
}
function MusicPlayer() {
  const audio = useRef(null); const [playing, setPlaying] = useState(false); const [muted, setMuted] = useState(false); const [notice, setNotice] = useState(false);
  const toggle = async () => {
    if (!MUSIC_URL) { setNotice(true); window.setTimeout(() => setNotice(false), 2500); return; }
    if (playing) { audio.current?.pause(); setPlaying(false); }
    else { try { await audio.current.play(); setPlaying(true); } catch { setNotice(true); window.setTimeout(() => setNotice(false), 2500); } }
  };
  return <div className="music-wrap">{MUSIC_URL && <audio ref={audio} src={MUSIC_URL} loop preload="none" muted={muted}/>}
    <button className="music-button" onClick={toggle}>{playing ? <Pause size={16}/> : <Music2 size={16}/>}<span>{playing ? "Pause music" : "Play music"}</span></button>
    {playing && <button className="music-mute" onClick={() => setMuted(v => !v)} aria-label="Toggle mute">{muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}</button>}
    <AnimatePresence>{notice && <motion.div className="music-notice" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}>{MUSIC_URL ? "Your browser could not start audio." : "Add your licensed music file in src/config.js."}</motion.div>}</AnimatePresence>
  </div>;
}
function StoryPhotoCarousel() {
  const photos = [
    { src: "/images/story_photo/0S4A0849.JPG", caption: "And somehow, every moment led me to you." },
    { src: "/images/story_photo/0S4A0897.JPG", caption: "From random conversations to endless memories." },
    { src: "/images/story_photo/img_20261122_194529_1.jpeg", caption: "My favourite place will always be beside you." },
    { src: "/images/story_photo/0S4A1188.JPG", caption: "We are meant to be." },
    { src: "/images/story_photo/0S4A1180.JPG", caption: "Written in the stars" },
    { src: "/images/story_photo/img_pondi.jpeg", caption: "A thousand little moments, one beautiful forever." },
    { src: "/images/story_photo/IMG-20260913-WA0061.jpeg", caption: "Every chapter brought us closer to this moment." }
  ];
  const track = useRef(null);
  const [active, setActive] = useState(0);
  const goTo = index => {
    const next = Math.max(0, Math.min(photos.length - 1, index));
    track.current?.scrollTo({ left: track.current.clientWidth * next, behavior: "smooth" });
    setActive(next);
  };
  const onScroll = () => {
    if (!track.current) return;
    setActive(Math.round(track.current.scrollLeft / track.current.clientWidth));
  };
  return <div className="story-photo story-photo-carousel">
    <div className="story-photo-track" ref={track} onScroll={onScroll} aria-label="Our story photos">
      {photos.map((photo, index) => <figure className="story-photo-slide" key={photo.src}>
        <img src={photo.src} alt={`Our story, photo ${index + 1} of ${photos.length}`} loading={index === 0 ? "eager" : "lazy"}/>
        <figcaption className="photo-caption"><b>{photo.caption}</b></figcaption>
      </figure>)}
    </div>
    <button className="story-photo-arrow story-photo-prev" type="button" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label="Previous story photo"><ChevronLeft size={20}/></button>
    <button className="story-photo-arrow story-photo-next" type="button" onClick={() => goTo(active + 1)} disabled={active === photos.length - 1} aria-label="Next story photo"><ChevronRight size={20}/></button>
    <div className="story-photo-dots" aria-label={`Photo ${active + 1} of ${photos.length}`}>
      {photos.map((photo, index) => <button key={photo.src} type="button" className={active === index ? "active" : ""} onClick={() => goTo(index)} aria-label={`Show story photo ${index + 1}`}/>)}
    </div>
  </div>;
}

function Wishes() {
  const [name,setName]=useState("");
  const [message,setMessage]=useState("");
  const honeypotRef=useRef(null);
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [submitting,setSubmitting]=useState(false);
  const [statusMessage,setStatusMessage]=useState("");
  const [errorMessage,setErrorMessage]=useState("");
  const [loadError,setLoadError]=useState("");

  useEffect(()=>{
    let active=true;
    fetch("/api/wishes",{headers:{Accept:"application/json"}})
      .then(async response=>{
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error||"Wishes are temporarily unavailable.");
        return data;
      })
      .then(data=>{if(active)setItems(Array.isArray(data.wishes)?data.wishes:[]);})
      .catch(()=>{if(active)setLoadError("We couldn't load wishes right now. Please try again later.");})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[]);

  const submit=async e=>{
    e.preventDefault();
    if(submitting||!name.trim()||!message.trim()) return;
    setSubmitting(true);
    setStatusMessage("");
    setErrorMessage("");
    try{
      const website=honeypotRef.current?.value?.trim()||"";
      const body=JSON.stringify({name:name.trim(),message:message.trim(),website});
      const payloadHash=await sha256Hex(body);
      const response=await fetch("/api/wishes",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-amz-content-sha256":payloadHash
        },
        body
      });
      const data=await response.json().catch(()=>({}));
      if(response.status===202){
        setErrorMessage("Your wish was not saved because the anti-spam check could not verify this submission. Please refresh the page and try again.");
        return;
      }
      if(response.status!==201) throw new Error(data.error||"We couldn't submit your wish. Please try again.");
      setName("");
      setMessage("");
      if(honeypotRef.current) honeypotRef.current.value="";
      setStatusMessage("Your wish has been published. Thank you!");
    }catch(error){
      setErrorMessage(error.message||"We couldn't submit your wish. Please try again.");
    }finally{
      setSubmitting(false);
    }
  };

  return <div className="wishes-layout"><form className="wish-form paper-card" onSubmit={submit}>
    <span className="card-kicker">LEAVE A LITTLE LOVE</span><h3>Send your wishes</h3><p className="muted">Your kind words will become a part of our story.</p>
    <label>Your name<input value={name} onChange={e=>setName(e.target.value)} placeholder="How should we call you?" maxLength={50} required/></label>
    <label>Your message<textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write a heartfelt wish..." rows="4" maxLength={400} required/></label>
    <div className="honeypot" aria-hidden="true"><label>Leave this field empty<input ref={honeypotRef} type="text" name="fax_number" tabIndex={-1} autoComplete="new-password" readOnly /></label></div>
    <button className="button primary" type="submit" disabled={submitting}><Send size={15}/> {submitting?"Sending...":"Send wishes"}</button>
    {statusMessage&&<span className="success" role="status"><Check size={14}/>{statusMessage}</span>}
    {errorMessage&&<span className="wish-error" role="alert">{errorMessage}</span>}
    <small>Wishes are reviewed before appearing publicly.</small>
  </form><div className="wish-feed"><div className="feed-title"><span className="eyebrow">KIND WORDS</span><h3>Notes from our loved ones</h3></div>
    {loading&&<p className="wish-empty">Loading wishes...</p>}
    {!loading&&loadError&&<p className="wish-error" role="alert">{loadError}</p>}
    {!loading&&!loadError&&!items.length&&<p className="wish-empty">Be the first to leave a little love.</p>}
    <AnimatePresence mode="popLayout">{items.map(w=><motion.article className="wish-note" key={w.wishId} layout initial={{opacity:0,x:14}} animate={{opacity:1,x:0}} exit={{opacity:0}}><span className="quote-mark">“</span><p>{w.message}</p><span className="wish-author">— {w.name}</span></motion.article>)}</AnimatePresence>
  </div></div>;
}
function PhotoUpload() {
  const [files,setFiles]=useState([]); const [sent,setSent]=useState(false);
  return <div className="upload-card"><div className="upload-icon"><ImagePlus size={27}/></div><span className="eyebrow">THE DAY THROUGH YOUR EYES</span>
    <h3>Help us keep every memory</h3><p>Captured a candid smile, a dance-floor moment or a little behind-the-scenes magic? We'd love to see it.</p>
    <label className="file-picker"><input type="file" accept="image/*" multiple onChange={e=>{setFiles(Array.from(e.target.files||[]).filter(f=>f.type.startsWith("image/")).slice(0,10));setSent(false);}}/><ImagePlus size={16}/> Choose photos</label>
    {files.length>0&&<div className="selected-files">{files.map((f,i)=><span key={f.name+i}><Check size={13}/>{f.name}</span>)}</div>}
    <button className="button primary upload-submit" disabled={!files.length} onClick={()=>setSent(true)}>Preview upload <ArrowUpRight size={15}/></button>
    {sent&&<span className="success"><Check size={14}/> {files.length} photo(s) selected. Online upload comes in a later milestone.</span>}
    <small>Photo sharing will open after the wedding. Uploads will be stored privately once connected.</small>
  </div>;
}
const giftSeed=[
  { id: "home", name: "A little something for our home", detail: "A thoughtful addition to our new beginnings.", image: IMAGES.gifts[0] },
  { id: "experience", name: "A memory-making experience", detail: "Help us create a memory to treasure.", image: IMAGES.gifts[1] },
  { id: "keepsake", name: "A keepsake for forever", detail: "A meaningful keepsake for our journey.", image: IMAGES.gifts[2] }
];
const GIFT_TOKEN_STORAGE_KEY = "wedding-gift-reservation-tokens-v1";

function GiftRegistry() {
  const [gifts, setGifts] = useState({});
  const [reservationTokens, setReservationTokens] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(GIFT_TOKEN_STORAGE_KEY) || "{}"); }
    catch { return {}; }
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedGift, setSelectedGift] = useState(null);
  const [reservationName, setReservationName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");

  const loadGifts = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/gifts", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Gift reservations are temporarily unavailable.");
      const next = {};
      (Array.isArray(data.gifts) ? data.gifts : []).forEach(gift => { next[gift.giftId] = gift; });
      setGifts(next);
    } catch (error) {
      setLoadError(error.message || "We couldn't load gift reservations. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadGifts(); }, []);
  useEffect(() => {
    try { window.localStorage.setItem(GIFT_TOKEN_STORAGE_KEY, JSON.stringify(reservationTokens)); }
    catch { /* The current page session can still use the in-memory token. */ }
  }, [reservationTokens]);

  const postGiftAction = async (path, payload) => {
    const body = JSON.stringify(payload);
    const payloadHash = await sha256Hex(body);
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-amz-content-sha256": payloadHash
      },
      body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "We couldn't complete this action. Please try again.");
    return data;
  };

  const openReservation = gift => {
    setSelectedGift(gift);
    setReservationName("");
    setActionError("");
  };

  const closeReservation = () => {
    if (saving) return;
    setSelectedGift(null);
    setReservationName("");
    setActionError("");
  };

  const confirmReservation = async event => {
    event.preventDefault();
    if (!selectedGift || saving || !reservationName.trim()) return;
    setSaving(true);
    setActionError("");
    try {
      const data = await postGiftAction("/api/gifts/reserve", {
        giftId: selectedGift.id,
        name: reservationName.trim()
      });
      setReservationTokens(current => ({ ...current, [selectedGift.id]: data.reservationToken }));
      setGifts(current => ({ ...current, [selectedGift.id]: { giftId: selectedGift.id, status: "RESERVED" } }));
      setToast("Your gift has been reserved. Thank you!");
      setSelectedGift(null);
      setReservationName("");
      window.setTimeout(() => setToast(""), 3000);
    } catch (error) {
      setActionError(error.message || "We couldn't reserve this gift. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const unreserve = async gift => {
    const token = reservationTokens[gift.id];
    if (!token || saving) return;
    setSaving(true);
    setActionError("");
    try {
      await postGiftAction("/api/gifts/unreserve", { giftId: gift.id, reservationToken: token });
      setReservationTokens(current => {
        const next = { ...current };
        delete next[gift.id];
        return next;
      });
      setGifts(current => ({ ...current, [gift.id]: { giftId: gift.id, status: "AVAILABLE" } }));
      setToast("Your reservation has been cancelled.");
      window.setTimeout(() => setToast(""), 3000);
    } catch (error) {
      setActionError(error.message || "We couldn't cancel this reservation. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return <>
    {loadError && <div className="gift-load-error" role="alert">{loadError}<button type="button" onClick={loadGifts}>Try again</button></div>}
    <div className="gift-grid">
      {giftSeed.map((gift, index) => {
        const status = gifts[gift.id]?.status || "AVAILABLE";
        const isMine = status === "RESERVED" && Boolean(reservationTokens[gift.id]);
        return <motion.article className="gift-card" key={gift.id} variants={reveal} initial="hidden" whileInView="visible" viewport={{ once: true }} transition={{ delay: index * .08 }}>
          <div className="gift-image"><img src={gift.image} alt="" loading="lazy"/><span>0{index + 1}</span></div>
          <div className="gift-info">
            <span className="card-kicker">A THOUGHTFUL GESTURE</span>
            <h3>{gift.name}</h3>
            <p>{gift.detail}</p>
            <div className="gift-bottom">
              <span>{loading ? "Checking..." : status === "RESERVED" ? (isMine ? "Reserved by you" : "Already reserved") : "Optional"}</span>
              {status === "AVAILABLE" ? (
                <button className="reserve" type="button" disabled={loading || saving || Boolean(loadError)} onClick={() => openReservation(gift)}>Reserve <ArrowUpRight size={13}/></button>
              ) : isMine ? (
                <button className="reserve unreserve" type="button" disabled={saving} onClick={() => unreserve(gift)}><X size={13}/> Unreserve</button>
              ) : (
                <span className="reserve reserved"><Check size={13}/> Reserved</span>
              )}
            </div>
          </div>
        </motion.article>;
      })}
    </div>
    <p className="demo-note">Reservations are optional. No payment is collected, and each gift can be reserved by one guest.</p>
    {actionError && !selectedGift && <p className="gift-action-error" role="alert">{actionError}</p>}
    <AnimatePresence>
      {selectedGift && <motion.div className="gift-modal-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) closeReservation(); }}>
        <motion.div className="gift-modal" role="dialog" aria-modal="true" aria-labelledby="gift-modal-title" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }}>
          <button className="gift-modal-close" type="button" onClick={closeReservation} disabled={saving} aria-label="Close"><X size={18}/></button>
          <span className="card-kicker">A THOUGHTFUL GESTURE</span>
          <h3 id="gift-modal-title">Reserve this gift</h3>
          <p>Thank you for thinking of us. Please confirm your name to reserve <strong>{selectedGift.name}</strong>.</p>
          <form onSubmit={confirmReservation}>
            <label htmlFor="gift-reservation-name">Your name</label>
            <input id="gift-reservation-name" value={reservationName} onChange={event => setReservationName(event.target.value)} placeholder="Enter your name" maxLength={50} autoFocus required/>
            {actionError && <p className="gift-action-error" role="alert">{actionError}</p>}
            <div className="gift-modal-actions">
              <button className="button gift-cancel" type="button" onClick={closeReservation} disabled={saving}>Cancel</button>
              <button className="button primary" type="submit" disabled={saving || !reservationName.trim()}>{saving ? "Reserving..." : "Confirm reservation"}</button>
            </div>
          </form>
        </motion.div>
      </motion.div>}
    </AnimatePresence>
    <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast}</motion.div>}</AnimatePresence>
  </>;
}

const eventDetails = [
  {
    title: "Wedding",
    ceremonyLabel: "THE WEDDING CEREMONY",
    ceremony: WEDDING.ceremony,
    date: WEDDING.dateLabel,
    time: WEDDING.ceremonyTime,
    venue: WEDDING.venue,
    address: WEDDING.address,
    mapUrl: WEDDING.mapUrl,
    image: IMAGES.venue,
    imageAlt: "Wedding celebration venue"
  },
  {
    title: "Reception",
    ceremonyLabel: "THE RECEPTION",
    ceremony: WEDDING.reception,
    date: WEDDING.receptionDateLabel || "Details to be announced",
    time: WEDDING.receptionTime,
    venue: WEDDING.receptionVenue || "Venue to be announced",
    address: WEDDING.receptionAddress || "",
    mapUrl: WEDDING.receptionMapUrl || "",
    image: IMAGES.reception,
    imageAlt: "Reception celebration and dining venue"
  }
];
function EventCarousel() {
  const track = useRef(null);
  const [active, setActive] = useState(0);
  const goTo = index => {
    const next = Math.max(0, Math.min(eventDetails.length - 1, index));
    track.current?.scrollTo({ left: track.current.clientWidth * next, behavior: "smooth" });
    setActive(next);
  };
  const onScroll = () => {
    if (!track.current) return;
    setActive(Math.round(track.current.scrollLeft / track.current.clientWidth));
  };
  return <div className="event-carousel">
    <div className="event-carousel-heading">
      <div><span className="card-kicker">EVENT {String(active + 1).padStart(2, "0")} OF 02</span><h3>{eventDetails[active].title}</h3></div>
      <div className="event-carousel-actions">
        <span className="swipe-hint">Swipe to view {eventDetails[1 - active].title} {active === 0 ? <ArrowRight size={14}/> : <ArrowLeft size={14}/>}</span>
        <button type="button" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label="Previous event"><ChevronLeft size={18}/></button>
        <button type="button" onClick={() => goTo(active + 1)} disabled={active === eventDetails.length - 1} aria-label="Next event"><ChevronRight size={18}/></button>
      </div>
    </div>
    <div className="event-carousel-track" ref={track} onScroll={onScroll}>
      {eventDetails.map((event, index) => <article className="event-slide" key={event.title}>
        <img className="event-slide-image" src={event.image} alt={event.imageAlt} loading="lazy"/>
        <div className="event-slide-details">
          <div className="event-block"><span className="event-icon"><Heart size={18}/></span><div><span className="card-kicker">{event.ceremonyLabel}</span><h3>{event.ceremony}</h3><p><CalendarDays size={14}/>{event.date}</p><p><Clock3 size={14}/>{event.time}</p></div></div>
          <div className="event-divider">✦</div>
          <div className="event-block"><span className="event-icon"><MapPin size={18}/></span><div><span className="card-kicker">THE VENUE</span><h3>{event.venue}</h3>{event.address && <p><MapPin size={14}/>{event.address}</p>}{event.mapUrl && <a href={event.mapUrl} target="_blank" rel="noreferrer">Get directions <ArrowUpRight size={14}/></a>}</div></div>
        </div>
      </article>)}
    </div>
    <div className="event-carousel-dots" aria-label={`Event ${active + 1} of 2`}>{eventDetails.map((event, index) => <button type="button" key={event.title} className={active === index ? "active" : ""} onClick={() => goTo(index)} aria-label={`Show ${event.title}`}/>)}</div>
  </div>;
}

export default function App() {
  const [menu,setMenu]=useState(false); const [active,setActive]=useState("invitation");
  const {scrollYProgress}=useScroll(); const progress=useSpring(scrollYProgress,{stiffness:100,damping:30,restDelta:.001});
  const nav=[["Our story","story"],["Countdown","countdown"],["The details","details"],["Wishes","wishes"],["Photos","photos"],["Gifts","gifts"]];
  useEffect(()=>{const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)setActive(e.target.id);}),{rootMargin:"-35% 0px -55% 0px"});document.querySelectorAll("section[id]").forEach(s=>observer.observe(s));return()=>observer.disconnect();},[]);
  const go=id=>{document.getElementById(id)?.scrollIntoView({behavior:"smooth"});setMenu(false);};
  return <div className="site-shell"><motion.div className="progress" style={{scaleX:progress}}/>
    <header className="topbar"><a className="brand" href="#invitation" onClick={e=>{e.preventDefault();go("invitation");}}><small>THE WEDDING OF</small><b>A <i>&</i> Y</b></a>
      <nav className="desktop-nav">{nav.map(([label,id])=><button key={id} className={active===id?"active":""} onClick={()=>go(id)}>{label}</button>)}</nav>
      <button className="menu-toggle" onClick={()=>setMenu(v=>!v)} aria-label="Toggle navigation">{menu?<X/>:<Menu/>}</button>
    </header>
    <AnimatePresence>{menu&&<motion.nav className="mobile-menu" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>{nav.map(([label,id])=><button key={id} onClick={()=>go(id)}>{label}<ArrowUpRight size={15}/></button>)}<button onClick={()=>go("thank-you")}>Thank you<ArrowUpRight size={15}/></button></motion.nav>}</AnimatePresence>
    <MusicPlayer/>
    <main>
      <section className="hero" id="invitation" style={{"--hero":`url("${IMAGES.hero}")`}}><div className="hero-frame">
        <div className="hero-ornament">✦ &nbsp; WITH THE BLESSINGS OF OUR FAMILIES &nbsp; ✦</div><motion.div className="hero-copy" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:1,delay:.2}}>
          <span className="hero-pretitle">JOYFULLY INVITE YOU TO CELEBRATE</span><h1>Ashkin<br/><em>&</em><br/>Yesodhaa</h1><Flourish/><p className="hero-subtitle">A beautiful beginning. A promise of forever.</p><span className="hero-date">{WEDDING.dateLabel}</span>
          <button className="hero-scroll" onClick={()=>go("story")}><span>DISCOVER OUR STORY</span><ArrowDown size={16}/></button>
        </motion.div><span className="hero-side">A CELEBRATION OF LOVE</span>
      </div></section>
      <section className="intro"><Flourish/><p>Two hearts, one journey, and a lifetime of memories waiting to unfold.</p><span>WE WOULD BE HONOURED BY YOUR PRESENCE</span></section>
      <section className="story section-pad" id="story"><StoryPhotoCarousel/>
        <div className="story-content"><Heading eyebrow="THE STORY OF US" title={<>A journey written<br/><i>in the stars</i></>} subtitle="From a first hello to a forever kind of love, every little moment brought us here."/>
          <div className="timeline">{WEDDING.story.map((item,i)=><motion.div className="timeline-item" key={item.date} variants={reveal} initial="hidden" whileInView="visible" viewport={{once:true}}><span className="timeline-dot">{String(i+1).padStart(2,"0")}</span><div><span className="timeline-date">{item.date}</span><h3>{item.title}</h3><p>{item.body}</p></div></motion.div>)}</div>
        </div>
      </section>
      <section className="countdown-section section-pad" id="countdown"><div className="pattern"/><div className="countdown-inner"><Heading light eyebrow="SAVE THE DATE" title={<>The countdown to<br/><i>forever</i></>} subtitle="A new chapter is almost here. We cannot wait to celebrate with you."/><Countdown/><div className="countdown-date"><CalendarDays size={16}/>{WEDDING.dateLabel}</div></div><span className="corner corner-a">✦</span><span className="corner corner-b">✦</span></section>
      <section className="details section-pad" id="details"><Heading eyebrow="THE CELEBRATION" title={<>Join us for our<br/><i>special day</i></>} subtitle="Your presence will make our celebration even more meaningful."/>
        <EventCarousel/>
      </section>
      <section className="wishes section-pad" id="wishes"><Heading eyebrow="A LITTLE NOTE FOR US" title={<>Your words, our<br/><i>forever keepsake</i></>} subtitle="Leave us a wish, a blessing or a little piece of advice for the journey ahead."/><Wishes/></section>
      <section className="photos section-pad" id="photos"><div className="pattern"/><Heading light eyebrow="SHARE THE JOY" title={<>Our day, through<br/><i>your eyes</i></>} subtitle="Every perspective holds a memory. Help us collect the moments we might have missed."/><PhotoUpload/></section>
      <section className="gifts section-pad" id="gifts"><Heading eyebrow="A THOUGHTFUL GESTURE" title={<>Your presence is<br/><i>our greatest gift</i></>} subtitle="If you wish to bless us with something more, we've put together a small collection of ideas for our new home."/><GiftRegistry/></section>
      <section className="thankyou" id="thank-you" style={{"--thanks":`url("${IMAGES.thanks}")`}}><div className="thankyou-content"><span className="eyebrow">UNTIL OUR PATHS MEET</span><Flourish/><h2>With love,<br/><i>and gratitude</i></h2><p>Thank you for being a part of our beautiful journey. Your love and blessings mean the world to us.</p><div className="thankyou-names">Ashkin <em>&</em> Yesodhaa</div><span className="thankyou-footer">MADE WITH LOVE · FOREVER BEGINS HERE</span></div></section>
    </main><footer className="footer"><span>A & Y</span><span>A CELEBRATION OF LOVE</span><button onClick={()=>go("invitation")}>Back to top ↑</button></footer>
  </div>;
}