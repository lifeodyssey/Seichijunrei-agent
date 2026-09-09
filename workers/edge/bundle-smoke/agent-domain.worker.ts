import { hostAddressOf, localizedCityName, selectedRouteMessage, statusValue } from "@animichi/agent";

export default {
  fetch(): Response {
    return Response.json({
      city: localizedCityName("Uji", "ja"),
      selection: selectedRouteMessage("en", 2),
      status: statusValue("<result>\n「Uji」"),
      address: hostAddressOf(new URL("https://2852039166/").hostname),
    });
  },
};
