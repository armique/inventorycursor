import {
  Albert_Sans,
  Archivo,
  Barlow,
  Bebas_Neue,
  DM_Sans,
  Exo_2,
  Figtree,
  Geist,
  Geist_Mono,
  IBM_Plex_Sans,
  Instrument_Sans,
  Inter,
  Jost,
  Lato,
  Lexend,
  Manrope,
  Montserrat,
  Nunito_Sans,
  Orbitron,
  Oswald,
  Outfit,
  Playfair_Display,
  Plus_Jakarta_Sans,
  Poppins,
  Raleway,
  Rajdhani,
  Roboto,
  Rubik,
  Sora,
  Space_Grotesk,
  Syne,
  Urbanist,
  Work_Sans,
} from "next/font/google";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });
const rajdhani = Rajdhani({ variable: "--font-rajdhani", subsets: ["latin"], weight: ["500", "600", "700"] });
const syne = Syne({ variable: "--font-syne", subsets: ["latin"], weight: ["600", "700", "800"] });
const bebasNeue = Bebas_Neue({ variable: "--font-bebas-neue", subsets: ["latin"], weight: "400" });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], weight: ["600", "700"] });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["500", "600", "700"] });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["500", "600", "700"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["500", "600", "700"] });
const plusJakarta = Plus_Jakarta_Sans({ variable: "--font-plus-jakarta", subsets: ["latin"], weight: ["500", "600", "700"] });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], weight: ["500", "600", "700"] });
const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["500", "600", "700"] });
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: ["500", "600", "700"] });
const lexend = Lexend({ variable: "--font-lexend", subsets: ["latin"], weight: ["500", "600", "700"] });
const ibmPlex = IBM_Plex_Sans({ variable: "--font-ibm-plex", subsets: ["latin"], weight: ["500", "600", "700"] });
const workSans = Work_Sans({ variable: "--font-work-sans", subsets: ["latin"], weight: ["500", "600", "700"] });
const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["500", "600", "700"] });
const urbanist = Urbanist({ variable: "--font-urbanist", subsets: ["latin"], weight: ["500", "600", "700"] });
const nunitoSans = Nunito_Sans({ variable: "--font-nunito-sans", subsets: ["latin"], weight: ["500", "600", "700"] });
const jost = Jost({ variable: "--font-jost", subsets: ["latin"], weight: ["500", "600", "700"] });
const exo2 = Exo_2({ variable: "--font-exo-2", subsets: ["latin"], weight: ["500", "600", "700"] });
const orbitron = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], weight: ["500", "600", "700"] });
const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin"], weight: ["500", "600", "700"] });
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], weight: ["500", "600", "700"] });
const instrumentSans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"], weight: ["500", "600", "700"] });
const raleway = Raleway({ variable: "--font-raleway", subsets: ["latin"], weight: ["500", "600", "700"] });
const lato = Lato({ variable: "--font-lato", subsets: ["latin"], weight: ["700"], style: ["normal"] });
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], weight: ["500", "700"] });
const albertSans = Albert_Sans({ variable: "--font-albert-sans", subsets: ["latin"], weight: ["500", "600", "700"] });

export const ALL_FONT_VARIABLES = [
  geistSans.variable,
  geistMono.variable,
  inter.variable,
  spaceGrotesk.variable,
  outfit.variable,
  rajdhani.variable,
  syne.variable,
  bebasNeue.variable,
  playfair.variable,
  dmSans.variable,
  oswald.variable,
  poppins.variable,
  montserrat.variable,
  plusJakarta.variable,
  manrope.variable,
  sora.variable,
  figtree.variable,
  lexend.variable,
  ibmPlex.variable,
  workSans.variable,
  barlow.variable,
  urbanist.variable,
  nunitoSans.variable,
  jost.variable,
  exo2.variable,
  orbitron.variable,
  rubik.variable,
  archivo.variable,
  instrumentSans.variable,
  raleway.variable,
  lato.variable,
  roboto.variable,
  albertSans.variable,
].join(" ");
