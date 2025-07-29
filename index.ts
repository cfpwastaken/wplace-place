import { PNG } from "pngjs";
import { createReadStream, createWriteStream, rmSync } from "fs";
import simpleGit from "simple-git";
import { spawn } from "child_process";

const TILES: `${number}/${number}`[] = [
	"1088/652",
	"1088/653",
	"1089/652",
	"1089/653",
	"1090/652",
	"1090/653",
];

const CHAR_HEIGHT = 7;
const GAP = 1;
const FONT_ORDER = "#¹²³⁴⁵⁶⁷⁸⁹⁰R/PLACE:% .1234567890";

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
	"%": 6,
	" ": 2,
	".": 2,
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
};

const URL = "https://cfp.is-a.dev/wplace/files/s0/tiles/X/Y.png?blending=out&tag=WPLACEPLACE";

// Fetch all tile URLs, count how many transparent pixels are in each tile, and return the results.
async function processTile(tile: `${number}/${number}`): Promise<{ total: number; done: number }> {
	const url = URL.replace("X", tile.split("/")[0]!).replace("Y", tile.split("/")[1]!);
	const response = await fetch(url);
	const buffer = await response.arrayBuffer();
	const png = PNG.sync.read(Buffer.from(buffer));

	let total = 0;
	let transparentPixels = 0;
	for (let i = 0; i < png.data.length; i += 4) {
		total++;
		if (png.data[i + 3] === 0) {
			transparentPixels++;
		}
	}
	return {
		total,
		done: transparentPixels
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

async function drawProgressOnImage(percentage: number) {
	const text = `R/PLACE ²⁰²³: ${percentage.toFixed(1)}%`;
	const fontImg = await loadPNG("font.png");
	const textWidth = calculateTextWidth(text);
	const png = new PNG({
		width: textWidth + 4, // 2px padding on each side
		height: CHAR_HEIGHT + 4, // 2px padding on each side
	});

	// Draw a background rectangle (WHITE with BLACK border), 2px padding on each side
	const padding = 2;
	const rectX = padding;
	const rectY = padding;
	const rectWidth = textWidth + padding * 2;
	const rectHeight = CHAR_HEIGHT + padding * 2;
	drawRect(png, rectX, rectY, rectWidth, rectHeight, BLACK);
	drawRect(png, rectX + 1, rectY + 1, rectWidth - 2, rectHeight - 2, WHITE);

	// Render the text onto the image
	await renderTextOntoImage(text, fontImg, png, 0, 0, padding);

	return png;
}

async function run() {
	const results = await Promise.all(TILES.map(tile => processTile(tile)));
	const totalPixels = results.reduce((sum, result) => sum + result.total, 0);
	const transparentPixels = results.reduce((sum, result) => sum + result.done, 0);
	const percentage = (transparentPixels / totalPixels * 100);
	
	console.log(`Total pixels: ${totalPixels}`);
	console.log(`Transparent pixels: ${transparentPixels}`);
	console.log(`Percentage of transparent pixels: ${percentage}%`);
	
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
	body.append("file", new Blob([buffer]));
	body.append("slug", "place2023-progress")
	const res = await fetch(`https://cfp.is-a.dev/wplace/api/replaceImage`, {
		method: "POST",
		headers: {
			"Content-Type": "multipart/form-data",
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

setInterval(() => {
	run();
}, 1000 * 60 * 60); // Run every hour

run(); // Initial run