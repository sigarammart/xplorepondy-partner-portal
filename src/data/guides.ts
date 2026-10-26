import type { Guide } from "@/lib/types";

export const guides: Guide[] = [
  {
    slug: "street-food-in-pondicherry",
    title: "Food streets of Pondicherry",
    excerpt:
      "Where to eat like a local: tiffin halls, Tamil nights, and the White Town bakeries everyone photographs.",
    date: "August 2026",
    readTime: "10 min",
    image: "/images/street-food.jpg",
    topic: "Food",
    sections: [
      {
        heading: "Two Pondys on a plate",
        body: "Pondicherry eats in two registers. White Town is croissants, tartines, and courtyard pasta. A kilometre inland, it is ghee roast, Chettinad kozhi, and filter coffee that could wake the lighthouse. A good trip uses both.",
      },
      {
        heading: "Breakfast, properly",
        body: "Start at Surguru or Sri Kamatchi for dosa and coffee before 9 AM, then walk off the spice on the promenade. If you would rather have butter than gunpowder, Baker Street on Bussy Street is the queue worth joining — weekday mornings are kinder. Café des Arts is the courtyard if you brought a book.",
      },
      {
        heading: "Street and snack",
        body: "Mission Street and the lanes around Goubert Market still hold the city’s everyday food: bonda, vadai, fresh juice, and evening chaat. For a seated Tamil dinner, Copper Kitchen in Ellaipillaichavady is the room locals actually name. White Town after 8 PM is more pub than tiffin.",
      },
      {
        heading: "A simple food day",
        body: "Filter coffee at sunrise on the rocks at Le Café. A proper South Indian lunch. A nap. Sunset again on the promenade. Dinner either in a heritage courtyard (Villa Shanti) or a restopub if the night is the point. That is the whole city, in four meals.",
      },
    ],
  },
  {
    slug: "shopping-in-pondicherry",
    title: "Shopping in Pondicherry: Best Markets, Street Shopping & Places to Shop",
    excerpt:
      "Traditional markets, terracotta streets, Mission Street boutiques, MG Road bargains, White Town design shops and Auroville crafts — a walking guide to where to actually shop.",
    date: "August 2026",
    readTime: "12 min",
    image: "/images/french-quarter.jpg",
    topic: "Shopping",
    siteUrl: "https://xplorepondy.com/guide/shopping-in-pondicherry/",
    sections: [
      {
        body: "Shopping in Pondicherry is much more than visiting boutiques and souvenir stores. The city offers a fascinating mix of **traditional markets, colourful street shops, handicrafts, terracotta, textiles, jewellery, Auroville products and modern boutiques**. From the busy streets around **MG Road and Chinnakadai** to the terracotta shops near **H.M. Kassim Salai and Manakula Vinayagar Temple**, each shopping area has its own character.",
        blocks: [
          {
            type: "p",
            text: "Shopping in Pondicherry is much more than visiting boutiques and souvenir stores. The city offers a fascinating mix of **traditional markets, colourful street shops, handicrafts, terracotta, textiles, jewellery, Auroville products and modern boutiques**.",
          },
          {
            type: "p",
            text: "From the busy streets around **MG Road and Chinnakadai** to the terracotta shops near **H.M. Kassim Salai and Manakula Vinayagar Temple**, each shopping area has its own character. Whether you’re looking for souvenirs, gifts, clothing, handicrafts or simply want to experience local street shopping, these are some of the best places to explore.",
          },
        ],
      },
      {
        heading: "Best Places for Shopping in Pondicherry",
        body: "A quick map of the city’s shopping streets.",
        blocks: [
          {
            type: "table",
            headers: ["Shopping area", "Best for"],
            rows: [
              ["H.M. Kassim Salai & Manakula Vinayagar", "Terracotta, handicrafts, religious souvenirs"],
              ["Mission Street", "Boutiques, clothing, gifts, handicrafts"],
              ["Nehru Street", "Everyday clothing, footwear, lifestyle"],
              ["MG Road & Chinnakadai", "Budget street shopping and bargains"],
              ["Goubert Market", "Produce, flowers, local atmosphere"],
              ["White Town", "Design, boutique and lifestyle"],
              ["Auroville", "Handmade and sustainable products"],
            ],
          },
        ],
      },
      {
        heading: "1. H.M. Kassim Salai & Manakula Vinayagar Temple Area",
        body: "Terracotta, handicrafts and inexpensive souvenirs next to the temple.",
        blocks: [
          {
            type: "p",
            text: "One of the most interesting shopping areas for tourists is the cluster of shops around **H.M. Kassim Salai, Manakula Vinayagar Street and the surrounding streets**. This area is particularly good for **terracotta, handicrafts, religious items and inexpensive souvenirs**.",
          },
          { type: "h3", text: "What to look for" },
          {
            type: "ul",
            items: [
              "Terracotta figurines",
              "Ganesha idols",
              "Clay dolls and sculptures",
              "Diyas and clay lamps",
              "Inexpensive souvenirs",
            ],
          },
          { type: "tip", label: "Suggested walking route", text: "**Manakula Vinayagar Temple → H.M. Kassim Salai → terracotta shops → Mission Street → Nehru Street.** A strong half-day shopping and sightseeing circuit in central Pondicherry." },
        ],
      },
      {
        heading: "2. Mission Street – Fashion, Boutiques & Souvenirs",
        body: "Curated clothing, jewellery and gifts.",
        blocks: [
          {
            type: "p",
            text: "Mission Street is one of Pondicherry’s most popular shopping streets and offers a combination of traditional shops, boutiques and tourist-oriented stores.",
          },
          {
            type: "ul",
            items: ["Clothing and casual wear", "Jewellery", "Bags and leather products", "Handicrafts and gifts", "Home décor"],
          },
        ],
      },
      {
        heading: "3. MG Road & Chinnakadai – Traditional Street Shopping",
        body: "Busy, inexpensive, and best walked with a bargain in mind.",
        blocks: [
          {
            type: "p",
            text: "For a more energetic local shopping experience, head towards **MG Road and Chinnakadai**. This area is packed with shops and street vendors selling inexpensive goods.",
          },
          { type: "h3", text: "Popular purchases" },
          { type: "ul", items: ["Budget clothing", "T-shirts", "Bags", "Footwear", "Accessories"] },
          { type: "tip", label: "Shopping tip", text: "Don’t buy the first thing you see. Walk the market, compare prices, then bargain. Smaller lanes off the main road hide the better stalls." },
        ],
      },
      {
        heading: "4. White Town & Auroville",
        body: "Design shops in the French Quarter; handmade goods at Auroville.",
        blocks: [
          {
            type: "p",
            text: "**White Town** is the place for premium souvenirs, independent boutiques and lifestyle shopping against mustard villas. **Auroville** is where to look for handmade paper, incense, organic food and clothes that survive a suitcase.",
          },
          { type: "tip", label: "Best for", text: "White Town if you want something designed; Auroville if you want something made." },
        ],
      },
      {
        heading: "Final Word",
        body: "Walk it in one loop.",
        blocks: [
          {
            type: "p",
            text: "Pondicherry’s shopping is best discovered on foot. Start with **terracotta around H.M. Kassim Salai and Manakula Vinayagar**, continue through **Mission Street and Nehru Street**, and finish with the markets around **MG Road and Chinnakadai**. For a quieter, more curated hour, peel off into **White Town**; for handmade and sustainable pieces, ride out to **Auroville**.",
          },
        ],
      },
    ],
  },
  {
    slug: "french-quarter",
    title: "Beautiful places in the French Quarter",
    excerpt:
      "A walking map of White Town: mustard villas, pink churches, and the sea at the end of every second street.",
    date: "August 2026",
    readTime: "10 min",
    image: "/images/french-quarter.jpg",
    topic: "Heritage",
    sections: [
      {
        heading: "How the quarter works",
        body: "White Town is a grid. The sea is east. The ashram and Manakula Vinayagar sit a few lanes in. Bharathi Park is the green centre. You can walk all of it in a morning if you do not stop; you should stop.",
      },
      {
        heading: "The loop",
        body: "Begin at Aayi Mandapam. Cut east to the promenade and walk north past the Gandhi statue and the old lighthouse. Drop back inland on Rue Dumas for Our Lady of Angels, then Rue Romain Rolland for the villas everyone photographs. End at the ashram if you want silence, or Le Café if you want coffee on the rocks.",
      },
      {
        heading: "Light",
        body: "Mustard walls need late afternoon. The promenade needs sunrise. The pink church needs a clear morning. Midday is for courtyards and museums; the streets glare.",
      },
    ],
  },
  {
    slug: "surfing-in-pondicherry",
    title: "Surfing in Pondicherry: Best Beaches to go Surfing",
    excerpt:
      "Serenity Beach is the hub. Auroville / Repos for a quieter line-up. Schools, prices and when to paddle out.",
    date: "August 2026",
    readTime: "14 min",
    image: "/images/surf.jpg",
    topic: "Adventure",
    siteUrl: "https://xplorepondy.com/guide/surfing-in-pondicherry-best-beaches-to-go-surfing-in-pondicherry/",
    sections: [
      {
        body: "Pondicherry is more than French streets, cafés and heritage buildings. Along its Bay of Bengal coastline, a growing surf culture has made it one of the more accessible places in South India to learn surfing.",
        blocks: [
          {
            type: "p",
            text: "Pondicherry is more than French streets, cafés and heritage buildings. Along its Bay of Bengal coastline, a growing surf culture has made the destination one of the more accessible places in South India to learn surfing.",
          },
          {
            type: "p",
            text: "For first-time surfers, **Serenity Beach and the surrounding Kottakuppam coastline** are the heart of the scene. Several surf schools operate here, offering everything from a single beginner lesson to private coaching and multi-day courses.",
          },
        ],
      },
      {
        heading: "Where Can You Go Surfing in Pondicherry?",
        body: "Three beaches, three moods.",
        blocks: [
          {
            type: "table",
            headers: ["Beach", "Best for"],
            rows: [
              ["Serenity Beach", "Beginners, lessons, the main surf hub"],
              ["Auroville / Repos Beach", "More experienced surfers, quieter line-up"],
              ["Paradise Beach", "A beach day — not the primary lesson beach"],
            ],
          },
        ],
      },
      {
        heading: "1. Serenity Beach",
        body: "The main surfing hub of Pondicherry.",
        blocks: [
          {
            type: "p",
            text: "**Serenity Beach** is the main surfing hub, around Kottakuppam / Thandryankuppam, a short drive north of town. Kallialay, Pondicherry Surf School, Mother Ocean, Guru Surf School and Serenity Surf Experience all operate on this stretch.",
          },
          { type: "tip", label: "Best for", text: "First lessons, board hire, and a full morning in the water. Book the day before; 6:30 AM arrivals are the calm ones." },
        ],
      },
      {
        heading: "2. Auroville Beach / Repos Beach",
        body: "A smaller ecosystem for people who already stand up.",
        blocks: [
          {
            type: "p",
            text: "Auroville Beach, also called Repos, sits a little further along the same coast. The scene is smaller than Serenity — better if you already surf and want fewer first-timers in the peak.",
          },
        ],
      },
      {
        heading: "Best Surf Schools in Pondicherry",
        body: "What a first lesson actually costs.",
        blocks: [
          {
            type: "p",
            text: "Most schools run **90-minute group lessons** with a board, leash and rashguard included. Group spots typically ask that you can **swim 50 metres confidently**. Kids under 11 are often steered into private lessons.",
          },
          {
            type: "table",
            headers: ["Format", "Typical price (2026)"],
            rows: [
              ["Group lesson (90 min)", "₹1,000 – ₹1,700"],
              ["Private lesson", "Ask the school — higher, more coaching"],
              ["3-day course", "₹4,500 – ₹4,800"],
            ],
          },
          { type: "tip", label: "Best time", text: "**Early morning, 6:00 AM – 10:00 AM** — cooler, softer light, cleaner peaks. Tide and wind still decide the day; the school will say if it’s on." },
          {
            type: "callout",
            label: "Xplore Pondy Verdict",
            text: "Serenity is the honest first stop. Book a school that actually wants to teach you, not only rent you a board for an hour.",
          },
        ],
      },
    ],
  },
  {
    slug: "organic-cafes",
    title: "Organic cafés in Pondicherry",
    excerpt:
      "Where wellness actually tastes like lunch — Auroville bakeries and White Town courtyards.",
    date: "August 2026",
    readTime: "3 min",
    image: "/images/cafe.jpg",
    topic: "Food",
    sections: [
      {
        body: "Auroville still sets the tone: sourdough, cold-pressed juices, bowls that are not a joke. Eat at the visitor centre, then hunt a community bakery if you have a scooter. Back in White Town, Café des Arts and Coromandel are the courtyard version of the same instinct — slower, greener, less butter than Baker Street. Go hungry; portions are honest.",
      },
    ],
  },
  {
    slug: "canyons-and-geology",
    title: "Canyons and geological marvels",
    excerpt:
      "Laterite, fossil beds, and the strange red earth that starts the moment you leave the French grid.",
    date: "August 2026",
    readTime: "4 min",
    image: "/images/matrimandir.jpg",
    topic: "Nature",
    sections: [
      {
        body: "Pondicherry’s drama is not only colonial. A short ride inland you hit laterite canyons, eroded red cliffs, and fossil-bearing beds that remind you this coast is old. Pair a canyon stop with Arikamedu — the Roman-era port — and you get a day that has nothing to do with croissants. Go early; there is almost no shade. Carry water, wear shoes you can ruin, and do not treat cliff edges as viewpoints.",
      },
    ],
  },
  {
    slug: "arikamedu-guide",
    title: "Arikamedu, the Roman port",
    excerpt:
      "Brick, tamarind, and a two-thousand-year-old trade with the Mediterranean.",
    date: "August 2026",
    readTime: "3 min",
    image: "/images/french-quarter.jpg",
    topic: "History",
    sections: [
      {
        body: "South of town, on a bend of the Ariyankuppam river, Arikamedu was a port that sent beads, textiles, and spices toward Rome. What remains is modest: brick walls, a ruined mission, trees. Read a page of the story before you go; the site rewards people who already know why they came. Combine it with Paradise Beach if you want sand after stones.",
      },
    ],
  },
  {
    slug: "photogenic-spots",
    title: "Photogenic spots you cannot miss",
    excerpt:
      "Eight frames that still look like Pondy after a thousand posts.",
    date: "August 2026",
    readTime: "8 min",
    image: "/images/promenade.jpg",
    topic: "Photography",
    sections: [
      {
        heading: "The list",
        body: "Gandhi statue at first light. The mustard villas on Rue Romain Rolland with bougainvillea. Our Lady of Angels, pink against a hard blue sky. Sacred Heart Basilica’s red-and-white façade. Matrimandir from the viewing point at 4 PM. Manakula Vinayagar’s gold vimana. Serenity Beach with a single board. Le Café’s rocks after rain.",
      },
      {
        heading: "How to shoot it",
        body: "Hire a bicycle, not a car. Midday is useless except inside churches. Ask before photographing people at the ashram and the temple. Drones over the promenade will not make you friends. The city is small; the light is the scarce resource.",
      },
    ],
  },
  {
    slug: "solo-travel-tips",
    title: "Solo travel in Pondicherry",
    excerpt:
      "A compact city that is kind to people who arrived with a bag and no plan.",
    date: "August 2026",
    readTime: "7 min",
    image: "/images/lighthouse.jpg",
    topic: "Tips",
    sections: [
      {
        heading: "Why it works",
        body: "Pondy is walkable, English is widely spoken, and a solo breakfast is a local sport. Women travelling alone generally find White Town straightforward in daylight; use the usual night sense after 10 PM, as you would in any small Indian city with a nightlife strip.",
      },
      {
        heading: "A three-day solo sketch",
        body: "Day one: bicycle the French Quarter and the promenade. Day two: scooter to Auroville and Serenity. Day three: scuba or a boat in the morning, cafés and a book in the afternoon. Book one heritage dinner so the evenings have a shape.",
      },
      {
        heading: "Practical",
        body: "Rent a scooter only if you already ride. Cycle rentals sit around Bharathi Park. ATMs are fine in town, thinner in Auroville. The ashram and Matrimandir inner chamber have dress and silence rules — read them. Your trip lives in this app until you close it; add places as you walk.",
      },
    ],
  },
];

export function getGuide(slug: string) {
  return (
    guides.find((g) => g.slug === slug) ||
    (slug.startsWith("surfing-in-pondicherry") ? guides.find((g) => g.slug === "surfing-in-pondicherry") : undefined) ||
    (slug.startsWith("shopping-in-pondicherry") ? guides.find((g) => g.slug === "shopping-in-pondicherry") : undefined)
  );
}
