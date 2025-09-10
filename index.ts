import { PNG } from "pngjs";
import { createReadStream, createWriteStream, rmSync } from "fs";
import simpleGit from "simple-git";
import { spawn } from "child_process";
import { CronJob } from "cron";

const TILES: `${number}/${number}`[] = [
	"1068/648",
	"1068/649",
	"1068/650",

	"1069/648",
	"1069/649",
	"1069/650",

	"1070/648",
	"1070/649",
	"1070/650",
];

const BASE_X = 294;
const BASE_Y = 591;

const crop = [
	{ // 1068/648, top-left
		x: BASE_X,
		y: BASE_Y,
		w: 1000 - BASE_X,
		h: 1000 - BASE_Y
	},
	{ // 1068/649, middle-left
		x: BASE_X,
		y: 0,
		w: 1000 - BASE_X,
		h: 1000
	},
	{ // 1068/650, bottom-left
		x: BASE_X,
		y: 0,
		w: 1000 - BASE_X,
		h: BASE_Y
	},

	{ // 1069/648, top-middle
		x: 0,
		y: BASE_Y,
		w: 1000,
		h: 1000 - BASE_Y
	},
	{ // 1069/649, middle-middle
		x: 0,
		y: 0,
		w: 1000,
		h: 1000
	},
	{ // 1069/650, bottom-middle
		x: 0,
		y: 0,
		w: 1000,
		h: BASE_Y
	},

	{ // 1070/648, top-right
		x: 0,
		y: BASE_Y,
		w: BASE_X,
		h: 1000 - BASE_Y
	},
	{ // 1070/649, middle-right
		x: 0,
		y: 0,
		w: BASE_X,
		h: 1000
	},
	{ // 1070/650, bottom-right
		x: 0,
		y: 0,
		w: BASE_X,
		h: BASE_Y
	}
]

const TOTAL_PIXELS = crop.reduce((sum, area) => sum + area.w * area.h, 0);
console.log("Total pixels in crop areas:", TOTAL_PIXELS);

const CHAR_HEIGHT = 7;
const GAP = 1;
const FONT_ORDER = "#¹²³⁴⁵⁶⁷⁸⁹⁰R/PLACE:% .1234567890!?=";

const CHAR_WIDTHS: { [key: string]: number } = {
  "#": 6,
  "¹": 3,
  "²": 5,
  "³": 4,
  "⁴": 6,
  "⁵": 4,
  "⁶": 5,
  "⁷": 4,
  "⁸": 5,
  "⁹": 5,
  "⁰": 5,
	"R": 5,
	"/": 4,
	"P": 5,
	"L": 4,
	"A": 5,
	"C": 4,
	"E": 4,
	":": 2,
	"%": 5,
	" ": 2,
	".": 1,
	"1": 4,
	"2": 4,
	"3": 4,
	"4": 4,
	"5": 4,
	"6": 4,
	"7": 4,
	"8": 4,
	"9": 4,
	"0": 4,
	"!": 1, // Off 7-segment one
	"?": 1, // On 7-segment one,
	"=": 4, // Off 7-segment zero
};

const URL = "https://backend.wplace.live/files/s0/tiles/X/Y.png";
const OVERLAY_URL = "https://cfp.is-a.dev/wplace/tiles/X/Y_orig.png?tag=WPLACEPLACE";

// Fetch all tile URLs, count how many transparent pixels are in each tile, and return the results.
async function processTile(tile: `${number}/${number}`): Promise<{ total: number; done: number }> {
	const url = URL.replace("X", tile.split("/")[0]!).replace("Y", tile.split("/")[1]!);
	const ovl_url = OVERLAY_URL.replace("X", tile.split("/")[0]!).replace("Y", tile.split("/")[1]!);
	console.log("[DEBUG] Fetching tile:", url);
	const response = await fetch(url);
	const ovl_response = await fetch(ovl_url);
	const buffer = await response.arrayBuffer();
	const ovl_buffer = await ovl_response.arrayBuffer();
	const png = PNG.sync.read(Buffer.from(buffer));
	const ovl_png = PNG.sync.read(Buffer.from(ovl_buffer));
	console.log("[DEBUG] Processing tile:", tile, `(${png.width}x${png.height})`);

	let total = 0;
	let donePixels = 0;
	for (let i = 0; i < png.data.length; i += 4) {
		const x = (i / 4) % png.width;
		const y = Math.floor((i / 4) / png.width);
		// Check if the pixel is within the crop area
		const [tileX, tileY] = tile.split("/").map(Number);
		const cropArea = crop[TILES.indexOf(tile)];
		if(!cropArea) {
			console.warn(`No crop area defined for tile ${tile}, skipping tile.`);
			continue;
		}
		if (x < cropArea.x || x >= cropArea.x + cropArea.w || y < cropArea.y || y >= cropArea.y + cropArea.h) {
			continue; // Skip pixels outside the crop area
		}

		total++;
		// if (png.data[i + 3] === 0) {
		// 	donePixels++;
		// }
		// Check if the same pixel in the overlay is the same color as this one
		if (png.data[i] === ovl_png.data[i] &&
			png.data[i + 1] === ovl_png.data[i + 1] &&
			png.data[i + 2] === ovl_png.data[i + 2] &&
			png.data[i + 3] === ovl_png.data[i + 3]) {
			donePixels++;
		}
	}
	return {
		total,
		done: donePixels
	};
}

// Calculate starting X position of each character
const CHAR_X_OFFSETS: { [key: string]: number } = {};
let xOffset = 0;
for (const char of FONT_ORDER) {
  CHAR_X_OFFSETS[char] = xOffset;
  xOffset += CHAR_WIDTHS[char]! + GAP;
}

function loadPNG(path: string): Promise<PNG> {
  return new Promise((resolve) => {
    const png = new PNG();
    createReadStream(path)
      .pipe(png)
      .on("parsed", () => {
        resolve(png);
      });
  });
}

async function renderTextOntoImage(text: string, fontImg: PNG, targetImg: PNG, xStart: number, yStart: number, gap: number = 1): Promise<void> {
	const chars = text.split("");

  let drawX = xStart;

  for (const ch of text) {
    const charW = CHAR_WIDTHS[ch];
    const srcX = CHAR_X_OFFSETS[ch];
    if (charW === undefined || srcX === undefined) continue;

    for (let y = 0; y < CHAR_HEIGHT; y++) {
      for (let x = 0; x < charW; x++) {
        const srcIdx = ((y * fontImg.width) + (srcX + x)) << 2;
        const dstIdx = ((yStart + y) * targetImg.width + (drawX + x)) << 2;

        targetImg.data[dstIdx] = fontImg.data[srcIdx]!;
        targetImg.data[dstIdx + 1] = fontImg.data[srcIdx + 1]!;
        targetImg.data[dstIdx + 2] = fontImg.data[srcIdx + 2]!;
        targetImg.data[dstIdx + 3] = fontImg.data[srcIdx + 3]!;
      }
    }

    drawX += charW + (gap - 1);
  }
}

function calculateTextWidth(text: string, gap: number = 1): number {
	const chars = text.split("");
	let textWidth = 0;
	for (const ch of chars) {
		const charW = CHAR_WIDTHS[ch];
		if (charW !== undefined) {
			textWidth += charW + gap; // Add character width and gap
			console.log(`Character "${ch}" width: ${charW}, total width so far: ${textWidth}`);
		} else {
			console.warn(`Character "${ch}" not found in CHAR_WIDTHS, skipping.`);
		}
	}
	return textWidth - gap; // Remove last gap
}

type Color = [number, number, number, number]; // RGBA

function drawRect(png: PNG, x: number, y: number, w: number, h: number, rgba: Color): void {
	for (let yy = y; yy < y + h; yy++) {
		for (let xx = x; xx < x + w; xx++) {
			const idx = (yy * png.width + xx) << 2;
			png.data[idx] = rgba[0];
			png.data[idx + 1] = rgba[1];
			png.data[idx + 2] = rgba[2];
			png.data[idx + 3] = rgba[3];
		}
	}
}

function runCommand(cmd: string, args: string[] = [], options: any = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit', ...options });

    proc.on('close', (code) => {
      if (code === 0) resolve(code);
      else reject(new Error(`Process exited with code ${code}`));
    });

    proc.on('error', reject);
  });
}

const WHITE: Color = [255, 255, 255, 255];
const BLACK: Color = [0, 0, 0, 255];

function formatProgressString(percentage: string): string {
	// 0xx.x% => !xx.x%
	// 1xx.x% => ?xx.x%
	if (percentage.startsWith("1")) {
		return "?" + percentage.slice(1);
	}
	percentage = "!" + percentage.slice(1);
	// !0x.x% => !=x.x%
	// !00.x% => !=0.x%
	if (percentage[1] === "0") {
		percentage = "!=" + percentage.slice(2);
	}
	return percentage;
}

async function drawProgressOnImage(percentage: number) {
	const floored = Math.floor(percentage * 10) / 10;
	const text = `${formatProgressString(floored.toFixed(1).padStart(5, "0"))}%`;
	const fontImg = await loadPNG("font.png");
	const textWidth = calculateTextWidth(text);
	const png = new PNG({
		width: textWidth,
		height: CHAR_HEIGHT,
	});

	// Render the text onto the image
	await renderTextOntoImage(text, fontImg, png, 0, 0, 2);

	return png;
}

async function addProgressToCSV(percentage: number) {
	const date = new Date().toISOString();
	const line = `${date},${percentage}\n`;
	await new Promise<void>((resolve, reject) => {
		const stream = createWriteStream("progress.csv", { flags: "a" });
		stream.write(line, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

async function run() {
	const results = await Promise.all(TILES.map(tile => processTile(tile)));
	const totalPixels = results.reduce((sum, result) => sum + result.total, 0);
	const transparentPixels = results.reduce((sum, result) => sum + result.done, 0);
	const percentage = (transparentPixels / totalPixels * 100);
	
	console.log(`Total pixels: ${totalPixels}`);
	console.log(`Transparent pixels: ${transparentPixels}`);
	console.log(`Percentage of transparent pixels: ${percentage}%`);

	await addProgressToCSV(percentage);
	
	// console.log("Cloning wplace-overlay repository...");
	// await simpleGit().clone("git+ssh://git@github.com/cfpwastaken/wplace-overlay.git", "wplace-overlay", ["--depth=1"]);
	// console.log("Rendering image onto canvas...");
	// const PIC_PATH = "wplace-overlay/tiles/1088/651_orig.png";
	// const pic = await loadPNG(PIC_PATH);
	// await drawProgressOnImage(pic, percentage);
	// console.log("Saving final image...");
	// await new Promise<void>((resolve) => {
	// 	pic.pack().pipe(createWriteStream(PIC_PATH)).on("finish", resolve);
	// });
	
	// console.log("Generating overlay...");
	// await runCommand("python3", ["border.py", "1088/651"], { cwd: "wplace-overlay/tiles" });
	
	// console.log("Committing changes...");
	// // Set commit author for the overlay repository
	// await simpleGit("wplace-overlay").addConfig("user.name", "Wplace DE Bot");
	// await simpleGit("wplace-overlay").addConfig("user.email", "wplace@example.com");
	// await simpleGit("wplace-overlay").add("./tiles/1088/651_orig.png");
	// await simpleGit("wplace-overlay").add("./tiles/1088/651.png");
	// await simpleGit("wplace-overlay").commit("tiles(place2023): update place 2023 progress");
	// console.log("Pushing changes to repository...");
	// await simpleGit("wplace-overlay").push("origin", "main");
	
	// console.log("Deletion of temporary files...");
	// rmSync("wplace-overlay", { recursive: true, force: true });

	const progressImage = await drawProgressOnImage(percentage);
	const API_KEY = process.env.API_KEY;
	if (!API_KEY) {
		console.error("API_KEY is not set. Please set the API_KEY environment variable.");
		return;
	}
	const body = new FormData();
	const buffer = PNG.sync.write(progressImage);
	body.append("file", new Blob([buffer]), "progress.png");
	body.append("slug", "place2022-progress");
	console.log("Uploading progress image...");
	const res = await fetch(`https://cfp.is-a.dev/wplace/api/replaceImage`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${API_KEY}`,
		},
		body
	});
	if(res.ok) {
		console.log("Progress image uploaded successfully.");
	} else {
		console.error("Failed to upload progress image:", res.statusText);
		const text = await res.text();
		console.error("Response body:", text);
	}
}

// setInterval(() => {
// 	run();
// }, 1000 * 60* 5); // Run every minute

// run(); // Initial run

const job = new CronJob("0 * * * *", run, null, true, "Europe/Berlin"); // Runs at the start of every hour
run(); // Initial run