import { fetchWeatherApi } from "openmeteo";

const params = {
  latitude: 52.52,
  longitude: 13.41,
  daily: "weather_code",
  hourly: [
    "temperature_2m",
    "wind_speed_10m",
    "wind_speed_1000hPa",
    "wind_speed_975hPa",
    "wind_speed_950hPa",
    "wind_speed_925hPa",
    "wind_speed_900hPa",
    "wind_speed_850hPa",
    "wind_speed_800hPa",
    "wind_speed_700hPa",
    "wind_speed_600hPa",
    "wind_speed_500hPa",
    "wind_direction_1000hPa",
    "wind_direction_975hPa",
    "wind_direction_950hPa",
    "wind_direction_925hPa",
    "wind_direction_900hPa",
    "wind_direction_850hPa",
    "wind_direction_800hPa",
    "wind_direction_700hPa",
    "wind_direction_600hPa",
    "wind_direction_500hPa",
    "visibility",
    "cloud_cover_high",
    "cloud_cover_low",
    "cloud_cover_mid",
  ],
  current: [
    "cloud_cover",
    "weather_code",
    "wind_gusts_10m",
    "wind_direction_10m",
    "wind_speed_10m",
  ],
  wind_speed_unit: "mph",
  temperature_unit: "fahrenheit",
};
const url = "https://api.open-meteo.com/v1/forecast";
(async () => {
  const responses = await fetchWeatherApi(url, params);

  // Process first location. Add a for-loop for multiple locations or weather models
  const response = responses[0];

  // Attributes for timezone and location
  const utcOffsetSeconds = response.utcOffsetSeconds();
  const timezone = response.timezone();
  const timezoneAbbreviation = response.timezoneAbbreviation();
  const latitude = response.latitude();
  const longitude = response.longitude();

  const current = response.current()!;
  const hourly = response.hourly()!;
  const daily = response.daily()!;

  // Note: The order of weather variables in the URL query and the indices below need to match!
  const weatherData = {
    current: {
      time: new Date((Number(current.time()) + utcOffsetSeconds) * 1000),
      cloudCover: current.variables(0)!.value(),
      weatherCode: current.variables(1)!.value(),
      windGusts10m: current.variables(2)!.value(),
      windDirection10m: current.variables(3)!.value(),
      windSpeed10m: current.variables(4)!.value(),
    },
    hourly: {
      time: [
        ...Array(
          (Number(hourly.timeEnd()) - Number(hourly.time())) / hourly.interval()
        ),
      ].map(
        (_, i) =>
          new Date(
            (Number(hourly.time()) + i * hourly.interval() + utcOffsetSeconds) *
              1000
          )
      ),
      temperature2m: hourly.variables(0)!.valuesArray()!,
      windSpeed10m: hourly.variables(1)!.valuesArray()!,
      windSpeed1000hPa: hourly.variables(2)!.valuesArray()!,
      windSpeed975hPa: hourly.variables(3)!.valuesArray()!,
      windSpeed950hPa: hourly.variables(4)!.valuesArray()!,
      windSpeed925hPa: hourly.variables(5)!.valuesArray()!,
      windSpeed900hPa: hourly.variables(6)!.valuesArray()!,
      windSpeed850hPa: hourly.variables(7)!.valuesArray()!,
      windSpeed800hPa: hourly.variables(8)!.valuesArray()!,
      windSpeed700hPa: hourly.variables(9)!.valuesArray()!,
      windSpeed600hPa: hourly.variables(10)!.valuesArray()!,
      windSpeed500hPa: hourly.variables(11)!.valuesArray()!,
      windDirection1000hPa: hourly.variables(12)!.valuesArray()!,
      windDirection975hPa: hourly.variables(13)!.valuesArray()!,
      windDirection950hPa: hourly.variables(14)!.valuesArray()!,
      windDirection925hPa: hourly.variables(15)!.valuesArray()!,
      windDirection900hPa: hourly.variables(16)!.valuesArray()!,
      windDirection850hPa: hourly.variables(17)!.valuesArray()!,
      windDirection800hPa: hourly.variables(18)!.valuesArray()!,
      windDirection700hPa: hourly.variables(19)!.valuesArray()!,
      windDirection600hPa: hourly.variables(20)!.valuesArray()!,
      windDirection500hPa: hourly.variables(21)!.valuesArray()!,
      visibility: hourly.variables(22)!.valuesArray()!,
      cloudCoverHigh: hourly.variables(23)!.valuesArray()!,
      cloudCoverLow: hourly.variables(24)!.valuesArray()!,
      cloudCoverMid: hourly.variables(25)!.valuesArray()!,
    },
    daily: {
      time: [
        ...Array(
          (Number(daily.timeEnd()) - Number(daily.time())) / daily.interval()
        ),
      ].map(
        (_, i) =>
          new Date(
            (Number(daily.time()) + i * daily.interval() + utcOffsetSeconds) *
              1000
          )
      ),
      weatherCode: daily.variables(0)!.valuesArray()!,
    },
  };

  // `weatherData` now contains a simple structure with arrays for datetime and weather data
  for (let i = 0; i < weatherData.hourly.time.length; i++) {
    // console.log(weatherData.hourly.time[i].toLocaleString(), {
    //   time: weatherData.hourly.time[i].toLocaleString(),
    //   temperature2m: `${weatherData.hourly.temperature2m[i]} °F`,
    //   windSpeeds: {
    //     "10m": `${weatherData.hourly.windSpeed10m[i]} mph`,
    //     "1000hPa": `${weatherData.hourly.windSpeed1000hPa[i]} mph`,
    //     "975hPa": `${weatherData.hourly.windSpeed975hPa[i]} mph`,
    //     "950hPa": `${weatherData.hourly.windSpeed950hPa[i]} mph`,
    //     "925hPa": `${weatherData.hourly.windSpeed925hPa[i]} mph`,
    //     "900hPa": `${weatherData.hourly.windSpeed900hPa[i]} mph`,
    //     "850hPa": `${weatherData.hourly.windSpeed850hPa[i]} mph`,
    //     "800hPa": `${weatherData.hourly.windSpeed800hPa[i]} mph`,
    //     "700hPa": `${weatherData.hourly.windSpeed700hPa[i]} mph`,
    //     "600hPa": `${weatherData.hourly.windSpeed600hPa[i]} mph`,
    //     "500hPa": `${weatherData.hourly.windSpeed500hPa[i]} mph`,
    //   },
    //   windDirections: {
    //     "1000hPa": `${weatherData.hourly.windDirection1000hPa[i]}°`,
    //     "975hPa": `${weatherData.hourly.windDirection975hPa[i]}°`,
    //     "950hPa": `${weatherData.hourly.windDirection950hPa[i]}°`,
    //     "925hPa": `${weatherData.hourly.windDirection925hPa[i]}°`,
    //     "900hPa": `${weatherData.hourly.windDirection900hPa[i]}°`,
    //     "850hPa": `${weatherData.hourly.windDirection850hPa[i]}°`,
    //     "800hPa": `${weatherData.hourly.windDirection800hPa[i]}°`,
    //     "700hPa": `${weatherData.hourly.windDirection700hPa[i]}°`,
    //     "600hPa": `${weatherData.hourly.windDirection600hPa[i]}°`,
    //     "500hPa": `${weatherData.hourly.windDirection500hPa[i]}°`,
    //   },
    //   visibility: `${weatherData.hourly.visibility[i]} m`,
    //   cloudCover: {
    //     high: `${weatherData.hourly.cloudCoverHigh[i]}%`,
    //     mid: `${weatherData.hourly.cloudCoverMid[i]}%`,
    //     low: `${weatherData.hourly.cloudCoverLow[i]}%`,
    //   },
    // });
  }
  for (let i = 0; i < weatherData.daily.time.length; i++) {
    console.log(
      weatherData.daily.time[i].toISOString(),
      weatherData.daily.weatherCode[i]
    );
  }
})();
