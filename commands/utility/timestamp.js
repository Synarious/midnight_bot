const { SlashCommandBuilder } = require('discord.js');
const { add } = require('date-fns');

const UNIT_MAP = {
  second: 'seconds',
  seconds: 'seconds',
  sec: 'seconds',
  secs: 'seconds',
  minute: 'minutes',
  minutes: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  hour: 'hours',
  hours: 'hours',
  hr: 'hours',
  hrs: 'hours',
  day: 'days',
  days: 'days',
  week: 'weeks',
  weeks: 'weeks',
  month: 'months',
  months: 'months',
  year: 'years',
  years: 'years'
};

const TIMEZONE_OFFSETS = {
  UTC: 0,
  GMT: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
  AKST: -540,
  AKDT: -480,
  HST: -600,
  BST: 60,
  CET: 60,
  CEST: 120,
  IST: 330,
  AEST: 600,
  AEDT: 660,
  JST: 540
};

function resolveUnit(rawUnit = '') {
  return UNIT_MAP[rawUnit.toLowerCase()] || null;
}

function parseTimeString(rawTime = '') {
  const trimmed = rawTime.trim().toLowerCase();
  if (!trimmed) return null;

  const meridiemMatch = trimmed.match(/(am|pm)$/);
  const meridiem = meridiemMatch ? meridiemMatch[1] : null;
  const withoutMeridiem = meridiem ? trimmed.replace(/(am|pm)$/i, '').trim() : trimmed;

  let hoursStr;
  let minutesStr;

  if (withoutMeridiem.includes(':')) {
    [hoursStr, minutesStr] = withoutMeridiem.split(':');
  } else if (withoutMeridiem.length > 2) {
    hoursStr = withoutMeridiem.slice(0, withoutMeridiem.length - 2);
    minutesStr = withoutMeridiem.slice(-2);
  } else {
    hoursStr = withoutMeridiem;
    minutesStr = '0';
  }

  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  if (minutes < 0 || minutes > 59) {
    return null;
  }

  let adjustedHours = hours;

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    if (meridiem === 'am') {
      adjustedHours = hours === 12 ? 0 : hours;
    } else {
      adjustedHours = hours === 12 ? 12 : hours + 12;
    }
  }

  if (!meridiem && (adjustedHours < 0 || adjustedHours > 23)) {
    return null;
  }

  return { hours: adjustedHours, minutes };
}

function extractTimezone(rawInput = '') {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { command: trimmed, timezone: null, offsetMinutes: null };
  }

  const match = trimmed.match(/(?:^|\s)([a-zA-Z]{2,4})$/);
  if (!match) {
    return { command: trimmed, timezone: null, offsetMinutes: null };
  }

  const abbreviation = match[1].toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(TIMEZONE_OFFSETS, abbreviation)) {
    return { command: trimmed, timezone: null, offsetMinutes: null };
  }

  const command = trimmed.slice(0, trimmed.length - abbreviation.length).trim();
  return { command, timezone: abbreviation, offsetMinutes: TIMEZONE_OFFSETS[abbreviation] };
}

// Create the slash command
module.exports = {
  data: new SlashCommandBuilder()
    .setName('timestamp')
    .setDescription('Generates a Discord timestamp from a human-readable time or date.')
    .addStringOption(option =>
      option.setName('time')
        .setDescription('The time or date to convert to a timestamp (e.g., "in 3 days" or "July 4, 2025")')
        .setRequired(true)),

  // Execute the slash command
  async execute(interaction) {
    const rawInput = interaction.options.getString('time').trim();
    const { command: cleanedCommand, timezone, offsetMinutes } = extractTimezone(rawInput);
    const command = cleanedCommand || rawInput;

    if (!command) {
      return interaction.reply('Please provide a date or time along with the timezone.');
    }

    try {
      let targetDate;
      const now = new Date();

      const relativeMatch = command.match(/^in\s+(\d+)\s+([a-zA-Z]+)(?:\s+at\s+(.+))?$/i);
      const onDayMatch = command.match(/^on\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+at\s+(.+))?$/i);

      if (relativeMatch) {
        const [, quantityStr, unitStr, timePart] = relativeMatch;
        const quantity = parseInt(quantityStr, 10);
        const resolvedUnit = resolveUnit(unitStr);

        if (Number.isNaN(quantity) || quantity < 0) {
          return interaction.reply('Please provide a valid quantity when using relative times.');
        }
        if (!resolvedUnit) {
          return interaction.reply('Sorry, I don\'t know that time unit. Try seconds, minutes, hours, days, weeks, months, or years.');
        }

        targetDate = add(now, { [resolvedUnit]: quantity });

        if (timePart) {
          const parsedTime = parseTimeString(timePart);
          if (!parsedTime) {
            return interaction.reply('I couldn\'t understand the time you provided.');
          }
          targetDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
        }
      } else if (onDayMatch) {
        const [, dayStr, timePart] = onDayMatch;
        const day = parseInt(dayStr, 10);

        if (day < 1 || day > 31) {
          return interaction.reply('Please provide a valid day of the month (1-31).');
        }

        const parsedTime = timePart ? parseTimeString(timePart) : null;
        if (timePart && !parsedTime) {
          return interaction.reply('I couldn\'t understand the time you provided.');
        }

        const initialTarget = new Date(
          now.getFullYear(),
          now.getMonth(),
          day,
          parsedTime ? parsedTime.hours : 0,
          parsedTime ? parsedTime.minutes : 0,
          0,
          0
        );

        let target = initialTarget;

        if (initialTarget <= now) {
          let nextMonth = now.getMonth() + 1;
          let nextYear = now.getFullYear();
          if (nextMonth > 11) {
            nextMonth = 0;
            nextYear += 1;
          }

          target = new Date(
            nextYear,
            nextMonth,
            day,
            parsedTime ? parsedTime.hours : 0,
            parsedTime ? parsedTime.minutes : 0,
            0,
            0
          );
        }

        if (target.getDate() !== day) {
          return interaction.reply('That date doesn\'t exist in that month. Try specifying a full date (e.g., "July 25").');
        }

        targetDate = target;
      } else {
        targetDate = new Date(command);
      }

      // Check if the date is valid
      if (isNaN(targetDate)) {
        return interaction.reply('Sorry, I couldn\'t understand that date.');
      }

      if (timezone && offsetMinutes !== null) {
        const utcMillis = Date.UTC(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate(),
          targetDate.getHours(),
          targetDate.getMinutes(),
          targetDate.getSeconds(),
          targetDate.getMilliseconds()
        ) - offsetMinutes * 60_000;

        targetDate = new Date(utcMillis);
      }

      // Convert to timestamp
      const timestamp = Math.floor(targetDate.getTime() / 1000);

      // Format into Discord timestamp
      const discordTimestamp = `<t:${timestamp}:R>`; // Use `R` for relative time
      const rawTimestamp = `<t:${timestamp}:R>`;
      const timezoneSuffix = timezone ? ` (${timezone})` : '';
      const response = `${discordTimestamp}${timezoneSuffix}\n\`\`\`\n${rawTimestamp}\n\`\`\``;

      // Reply with the Discord timestamp
      return interaction.reply(response);
    } catch (error) {
      console.error('Error processing the date:', error);
      return interaction.reply('Sorry, there was an error processing that time!');
    }
  },
};
