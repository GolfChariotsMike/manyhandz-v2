export type FAQ = { q: string; a: string };
export type HoursRow = { day: string; open: string; close: string; closed: boolean };

export const INDUSTRIES = [
  "Trade / Construction", "Hospitality", "Health / Allied Health",
  "Retail", "Professional Services", "Real Estate",
  "Sport / Fitness", "Education", "Other",
] as const;

export const DEFAULT_HOURS: HoursRow[] = [
  { day: "Monday", open: "09:00", close: "17:00", closed: false },
  { day: "Tuesday", open: "09:00", close: "17:00", closed: false },
  { day: "Wednesday", open: "09:00", close: "17:00", closed: false },
  { day: "Thursday", open: "09:00", close: "17:00", closed: false },
  { day: "Friday", open: "09:00", close: "17:00", closed: false },
  { day: "Saturday", open: "09:00", close: "13:00", closed: false },
  { day: "Sunday", open: "", close: "", closed: true },
];

export const SIGNUP_CAPABILITY_CHIPS = [
  { id: "answer_faqs", label: "Answer FAQs" },
  { id: "take_messages", label: "Take messages" },
  { id: "book_callbacks", label: "Book callbacks" },
  { id: "transfer_to_me", label: "Transfer to me" },
] as const;

export type SignupCapabilityId = (typeof SIGNUP_CAPABILITY_CHIPS)[number]["id"];

export const INDUSTRY_TEMPLATES: Record<string, { about: string; services: string[]; faqs: FAQ[] }> = {
  "Trade / Construction": {
    about: "We're a local trade business providing quality workmanship and reliable service. We pride ourselves on showing up on time, doing the job right, and keeping our customers informed throughout.",
    services: ["Free quotes", "Residential work", "Commercial work", "Emergency callouts", "Maintenance"],
    faqs: [
      { q: "Do you provide free quotes?", a: "Yes, we offer free no-obligation quotes. Just give us a call or send us a message with the details." },
      { q: "How quickly can you come out?", a: "We aim to respond within 24 hours for standard jobs, and offer emergency callouts for urgent work." },
      { q: "Are you licensed and insured?", a: "Yes, we're fully licensed and insured for all work we carry out." },
    ],
  },
  "Hospitality": {
    about: "We're passionate about great food, great drinks, and great hospitality. Whether you're popping in for a quick bite or celebrating a special occasion, we're here to make it memorable.",
    services: ["Dine in", "Takeaway", "Function bookings", "Catering", "Gift vouchers"],
    faqs: [
      { q: "Do you take reservations?", a: "Yes, we take bookings — give us a call or message us your preferred date and time." },
      { q: "Do you cater for dietary requirements?", a: "Absolutely. Let us know your requirements and we'll do our best to accommodate you." },
      { q: "What are your trading hours?", a: "Please check our current hours — they can vary by day. Feel free to call us to confirm." },
    ],
  },
  "Health / Allied Health": {
    about: "We're a dedicated health practice committed to helping our patients achieve their best health outcomes. Our team takes a personalised approach to every patient.",
    services: ["Consultations", "Assessments", "Treatment plans", "Follow-up appointments", "Telehealth"],
    faqs: [
      { q: "How do I book an appointment?", a: "You can call us, message us, or book online. We'll find a time that works for you." },
      { q: "Do you accept health insurance?", a: "We accept most major health funds. Contact us to confirm your specific cover." },
      { q: "How long is each appointment?", a: "Initial consultations are typically 45-60 minutes. Follow-ups are usually 30 minutes." },
    ],
  },
  "Retail": {
    about: "We're a local retailer offering quality products and personal service. We love helping customers find exactly what they're looking for.",
    services: ["In-store shopping", "Online orders", "Click & collect", "Gift wrapping", "Returns & exchanges"],
    faqs: [
      { q: "What are your store hours?", a: "Please message us or check our website for current trading hours." },
      { q: "Do you offer refunds?", a: "Yes, we accept returns within 30 days with proof of purchase. Items must be in original condition." },
      { q: "Do you ship online orders?", a: "Yes, we ship Australia-wide. Flat rate shipping with free shipping on orders over a certain amount." },
    ],
  },
  "Professional Services": {
    about: "We're a professional services firm focused on delivering expert advice and practical solutions for our clients. We build long-term relationships based on trust, expertise, and results.",
    services: ["Consultations", "Advice & strategy", "Document preparation", "Ongoing support", "Reviews & audits"],
    faqs: [
      { q: "How do I get started?", a: "Book an initial consultation and we'll assess your situation and outline how we can help." },
      { q: "How much does it cost?", a: "Fees vary depending on the service. We provide a clear quote before commencing any work." },
      { q: "How quickly can I expect a response?", a: "We aim to respond to all enquiries within 1 business day." },
    ],
  },
  "Real Estate": {
    about: "We're a dedicated real estate team committed to helping buyers, sellers, and renters navigate the property market with confidence.",
    services: ["Property appraisals", "Sales", "Property management", "Rental listings", "Buyer's advocacy"],
    faqs: [
      { q: "How do I get a property appraisal?", a: "Contact us to book a free appraisal. One of our agents will visit your property and provide a market estimate." },
      { q: "What fees do you charge?", a: "Our fees vary by service. We'll provide full transparency on costs before you commit to anything." },
      { q: "How long does it take to sell a property?", a: "It depends on the market and property type. We'll give you a realistic timeline based on current conditions." },
    ],
  },
  "Sport / Fitness": {
    about: "We're passionate about helping people move, improve, and feel great. Whether you're a beginner or a seasoned athlete, we have something for you.",
    services: ["Classes & sessions", "Personal training", "Memberships", "Casual passes", "Group programs"],
    faqs: [
      { q: "Do I need to be fit to join?", a: "Not at all! We welcome all fitness levels and tailor sessions to suit you." },
      { q: "How do I book a session?", a: "You can book online or message us directly. We'll find a time that suits you." },
      { q: "Do you offer trial sessions?", a: "Yes, we offer trial sessions for new members. Ask us about our current intro offer." },
    ],
  },
  "Education": {
    about: "We're dedicated to helping students learn, grow, and reach their potential. Our approach is personalised, supportive, and results-focused.",
    services: ["Tutoring", "Group classes", "Online sessions", "Assessment prep", "Holiday programs"],
    faqs: [
      { q: "What ages do you work with?", a: "We work with students across a range of ages and year levels. Contact us to discuss your needs." },
      { q: "How do sessions work?", a: "Sessions are tailored to each student. We assess their current level and build a plan to fill gaps and extend their knowledge." },
      { q: "How quickly will I see results?", a: "Most students see improvement within a few sessions. Consistency is key." },
    ],
  },
  "Other": {
    about: "We're a local business focused on delivering great service and real value to our customers.",
    services: ["Enquiries welcome", "Custom quotes", "Consultations"],
    faqs: [
      { q: "How do I get in touch?", a: "Just call, message, or email us and we'll get back to you as soon as possible." },
      { q: "Do you offer quotes?", a: "Yes — contact us with the details of what you need and we'll provide a quote." },
    ],
  },
};

export function applyIndustryTemplate(industry: string): { about: string; services: string[]; faqs: FAQ[] } | null {
  return INDUSTRY_TEMPLATES[industry] || null;
}
